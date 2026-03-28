import streamlit as st
import pandas as pd
import joblib
import os
import io
import numpy as np
from streamlit_option_menu import option_menu

st.set_page_config(page_title="Predictor LOS | Clínica Sagrado Corazón", layout="wide")

# Configuración de Estilo
st.markdown("""
    <style>
    .main { background-color: #f5f7f9; }
    .stMetric { background-color: white; padding: 15px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
    </style>
    """, unsafe_allow_html=True)

@st.cache_resource
def cargar_recursos():
    # Rutas relativas y absolutas para robustez
    paths = ['modelo_estancia_v4.pkl', 'prediccion/modelo_estancia_v4.pkl']
    cols_paths = ['columnas_modelo_v4.pkl', 'prediccion/columnas_modelo_v4.pkl']
    
    modelo = None
    columnas = None
    
    for p in paths:
        if os.path.exists(p):
            modelo = joblib.load(p)
            break
    for p in cols_paths:
        if os.path.exists(p):
            columnas = joblib.load(p)
            break
            
    return modelo, columnas

modelo, columnas_entrenamiento = cargar_recursos()

if modelo is None:
    st.error("❌ No se pudo cargar el modelo V4. Verifique que los archivos .pkl existan en /prediccion.")
    st.stop()

def aplicar_logica_clinica(df):
    # Estandarización de columnas
    df.columns = [str(c).strip().replace('\n', '') for c in df.columns]
    mapeo = {
        '#ing': 'Identificacion', 'TFCedu': 'Identificacion', 'NUM DOC': 'Identificacion',
        'EDAD': 'edad', 'Edad': 'edad', 'Sexo': 'Sexo',
        'Estancia': 'Dias_Actuales', 'Cama': 'CAMA',
        'PabIngreso': 'PabellonIngreso', 'EspecTratante': 'Esp'
    }
    df = df.rename(columns=mapeo)
    
    # LÓGICA DE DIAGNÓSTICO PRIORITARIO (Dx2 > Dx3 > Dx1)
    if 'Dx2' in df.columns:
        df['Dx_Analisis'] = df['Dx2'].fillna(df.get('Dx3', df.get('Dx1', 'OTR')))
    else:
        df['Dx_Analisis'] = df.get('Dx1', 'OTR')

    # Comorbilidades
    dx_texto = (df.get('Dx1Nombre', '').fillna('') + " " + df.get('Dx2Nombre', '').fillna('')).str.upper()
    com_patterns = {
        'Diabetes': 'DIABETES', 'Hipertension': 'HIPERTENSION|HTA', 
        'Cardiaca': 'CARDIAC|INFARTO|ISQUEMI|FALLA', 'EPOC': 'EPOC|PULMONAR OBSTRUCTIVA',
        'Renal': 'RENAL|NEFRO', 'VIH': 'VIH|SIDA'
    }
    for col, pat in com_patterns.items():
        df[col] = dx_texto.str.contains(pat).astype(int)
    
    df['Total_Comorbilidades'] = df[list(com_patterns.keys())].sum(axis=1)
    df['edad'] = pd.to_numeric(df.get('edad', 50), errors='coerce').fillna(50)
    df['Sexo'] = df.get('Sexo', 'M').fillna('M')
    df['Dx_Agrupado'] = df['Dx_Analisis'].astype(str).str[:4]
    
    if 'PabellonIngreso' not in df.columns:
        df['PabellonIngreso'] = 'HOSPITALIZACION'
        
    return df

st.title("🏥 Sistema de Alerta Temprana - LOS Predictor")
st.caption("Versión 4.0 - Lógica Clínica Avanzada Habilitada")

menu = option_menu(None, ["Análisis de Censo", "Configuración"], icons=["table", "gear"], orientation="horizontal")

if menu == "Análisis de Censo":
    archivo = st.file_uploader("Subir Archivo de Censo (Excel o CSV con tabulaciones)", type=["xlsx", "csv", "txt"])
    
    if archivo:
        try:
            if archivo.name.endswith('.xlsx'):
                df_raw = pd.read_excel(archivo)
            else:
                # Intento robusto para Tab y Punto y Coma
                raw_bytes = archivo.read()
                try:
                    df_raw = pd.read_csv(io.BytesIO(raw_bytes), sep='\t', encoding='latin1')
                    if len(df_raw.columns) < 5: raise Exception()
                except:
                    df_raw = pd.read_csv(io.BytesIO(raw_bytes), sep=None, engine='python', encoding='latin1')

            df = aplicar_logica_clinica(df_raw)
            
            # Preparar para modelo
            cols_modelo = ['edad', 'Sexo', 'PabellonIngreso', 'Esp', 'Dx_Agrupado', 'Diabetes', 'Hipertension', 'Cardiaca', 'EPOC', 'Renal', 'VIH', 'Total_Comorbilidades']
            X = pd.get_dummies(df[[c for c in cols_modelo if c in df.columns]]).reindex(columns=columnas_entrenamiento, fill_value=0)
            
            # Predicción
            preds = modelo.predict(X)
            df['Dias_Estancia_Predicha'] = preds
            df['Dias_Actuales'] = pd.to_numeric(df.get('Dias_Actuales', 0), errors='coerce').fillna(0)
            df['Alerta'] = np.where(df['Dias_Actuales'] > df['Dias_Estancia_Predicha'], "⚠️ Desviación", "✅ Normal")

            # KPIs
            c1, c2, c3 = st.columns(3)
            c1.metric("Total Pacientes", len(df))
            c2.metric("Desviados (Bloqueo)", sum(df['Alerta'] == "⚠️ Desviación"))
            c3.metric("Riesgo Estancia > 8d", sum(df['Dias_Estancia_Predicha'] > 8))

            st.subheader("Detalle de Pacientes")
            st.dataframe(df[['Identificacion', 'Dx_Analisis', 'Dias_Actuales', 'Dias_Estancia_Predicha', 'Alerta']].style.applymap(
                lambda x: 'background-color: #ffcccc' if x == "⚠️ Desviación" else '', subset=['Alerta']
            ), use_container_width=True)

        except Exception as e:
            st.error(f"Error procesando archivo: {e}")

if menu == "Configuración":
    st.info("El motor está configurado en el puerto 8001. Esta App carga el modelo internamente para mayor velocidad.")
    st.write("Estado del Modelo:", "✅ Listo" if modelo else "❌ Error")
    st.write("Version:", "4.0.0")