import pandas as pd
import numpy as np
import os
import time
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score
import joblib

os.system('')

CYAN = '\033[96m'
GREEN = '\033[92m'
YELLOW = '\033[93m'
RED = '\033[91m'
BOLD = '\033[1m'
RESET = '\033[0m'

def print_step(msg):
    print(f"\n{CYAN}{BOLD}➤ {msg}{RESET}")

def print_success(msg):
    print(f"{GREEN}✔ {msg}{RESET}")

def print_warning(msg):
    print(f"{YELLOW}⚠ {msg}{RESET}")

def print_error(msg):
    print(f"{RED}✖ {msg}{RESET}")

def load_data():
    csv_file = 'BD_Consolidada EGRESOS MODIFICADO.csv'
    excel_file = 'BD_Consolidada EGRESOS MODIFICADO.xlsx'
    
    if os.path.exists(csv_file):
        print_step("Cargando base de datos desde CSV (Modo Súper Rápido)...")
        try:
            df = pd.read_csv(csv_file, sep=';', encoding='latin1', low_memory=False)
        except UnicodeDecodeError:
            df = pd.read_csv(csv_file, sep=';', encoding='utf-8', low_memory=False)
        return df
    elif os.path.exists(excel_file):
        print_step("Cargando base de datos desde Excel (Puede tardar varios minutos)...")
        df = pd.read_excel(excel_file, sheet_name='BD')
        return df
    else:
        raise FileNotFoundError("Base de datos no encontrada.")

def preprocess_data(df_total):
    print_step("Filtrando pacientes y calculando tiempos EXACTOS de estancia...")
    
    if 'AtnActual' in df_total.columns:
        df_total['AtnActual'] = df_total['AtnActual'].fillna('')
        mask_ambulatorio = df_total['AtnActual'].str.contains('Ambulatorio|Triage|CONSULTA EXTERNA', case=False, na=False)
        df_camas = df_total[~mask_ambulatorio].copy()
    else:
        df_camas = df_total.copy()
    
    if 'FechaIngreso' in df_camas.columns and 'Fechaegreso' in df_camas.columns:
        df_camas['FechaIngreso'] = pd.to_datetime(df_camas['FechaIngreso'], errors='coerce')
        df_camas['Fechaegreso'] = pd.to_datetime(df_camas['Fechaegreso'], errors='coerce')
        df_camas = df_camas.dropna(subset=['FechaIngreso', 'Fechaegreso'])
        # Calculamos los días exactos de estancia (incluyendo decimales)
        df_camas['Dias_Estancia'] = (df_camas['Fechaegreso'] - df_camas['FechaIngreso']).dt.total_seconds() / (24 * 3600)
        df_camas = df_camas[df_camas['Dias_Estancia'] >= 0.1]
    
    print_success(f"Pacientes válidos para regresión: {len(df_camas)} registros.")
    return df_camas

def extract_comorbidities(df_camas):
    print_step("Extrayendo comorbilidades complejas (Minería Clínica V4)...")
    
    if 'Dx2Nombre' in df_camas.columns and 'Dx3Nombre' in df_camas.columns:
        df_camas['Texto_Dx'] = df_camas['Dx2Nombre'].fillna('').str.upper() + " " + df_camas['Dx3Nombre'].fillna('').str.upper()
    else:
        df_camas['Texto_Dx'] = ""
    
    df_camas['Diabetes'] = df_camas['Texto_Dx'].str.contains('DIABETES').astype(int)
    df_camas['Hipertension'] = df_camas['Texto_Dx'].str.contains('HIPERTENSION|HTA|PRESION ALTA').astype(int)
    df_camas['Cardiaca'] = df_camas['Texto_Dx'].str.contains('CARDIAC|INFARTO|ISQUEMI|FALLA').astype(int)
    df_camas['EPOC'] = df_camas['Texto_Dx'].str.contains('EPOC|PULMONAR OBSTRUCTIVA').astype(int)
    df_camas['Hemato_Onco'] = df_camas['Texto_Dx'].str.contains('CANCER|TUMOR|LEUCEMIA|LINFOMA|NEOPLASIA|MALIGN|HEMATO').astype(int)
    df_camas['Quimio'] = df_camas['Texto_Dx'].str.contains('QUIMIO').astype(int)
    df_camas['Hemofilia'] = df_camas['Texto_Dx'].str.contains('HEMOFILIA').astype(int)
    df_camas['Porfiria'] = df_camas['Texto_Dx'].str.contains('PORFIRIA').astype(int)
    df_camas['Renal'] = df_camas['Texto_Dx'].str.contains('RENAL|NEFRO').astype(int)
    df_camas['VIH'] = df_camas['Texto_Dx'].str.contains('VIH|SIDA|INMUNODEFICIENCIA HUMANA').astype(int)
    
    cols_enfermedades = ['Diabetes', 'Hipertension', 'Cardiaca', 'EPOC', 'Hemato_Onco', 'Quimio', 'Hemofilia', 'Porfiria', 'Renal', 'VIH']
    df_camas['Total_Comorbilidades'] = df_camas[cols_enfermedades].sum(axis=1)
    
    return df_camas

def build_features_and_target(df_camas):
    print_step("Estructurando modelo predictivo de REGRESIÓN (Días Numéricos)...")
    
    if 'Dx' in df_camas.columns:
        df_camas['Dx_Agrupado'] = df_camas['Dx'].astype(str).str[:4]
    else:
        df_camas['Dx_Agrupado'] = "DESCONOCIDO"
        
    if 'edad' in df_camas.columns:
        df_camas['edad'] = df_camas['edad'].astype(str).str.replace(r'\D', '', regex=True)
        df_camas['edad'] = pd.to_numeric(df_camas['edad'], errors='coerce').fillna(50)
    
    columnas_x = ['edad', 'Sexo', 'PabellonIngreso', 'Esp', 'Dx_Agrupado', 
                  'Diabetes', 'Hipertension', 'Cardiaca', 'EPOC', 'Hemato_Onco', 
                  'Quimio', 'Hemofilia', 'Porfiria', 'Renal', 'VIH', 'Total_Comorbilidades']
                  
    col_disponibles = [col for col in columnas_x if col in df_camas.columns]
    
    X = df_camas[col_disponibles].copy()
    X = X.dropna()
    
    # IMPORTANTE: Ahora el objetivo 'y' es el número exacto de días, NO UNA CATEGORÍA.
    y = df_camas.loc[X.index, 'Dias_Estancia']
    
    # Limpiar Outliers Extremos para no distorsionar el modelo numérico (Ej > 180 días)
    # Solo tomamos aquellos por debajo del percentil 99
    limite = y.quantile(0.99)
    mascara_validos = y <= limite
    X = X[mascara_validos]
    y = y[mascara_validos]
    
    X_numerico = pd.get_dummies(X, drop_first=True)
    return X_numerico, y

def train_and_evaluate(X, y):
    print_step("Entrenando Regresor de Bosques Aleatorios V4 (Dias Continuos)...")
    
    joblib.dump(list(X.columns), 'columnas_modelo_v4.pkl')
    print_success("Estructura de variables V4 guardada.")
    
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    modelo = RandomForestRegressor(n_estimators=100, max_depth=15, random_state=42, n_jobs=-1)
    
    start_time = time.time()
    modelo.fit(X_train, y_train)
    training_time = time.time() - start_time
    print_success(f"Entrenamiento completado en {training_time:.2f} segundos.")
    
    predicciones = modelo.predict(X_test)
    error_medio = mean_absolute_error(y_test, predicciones)
    score_r2 = r2_score(y_test, predicciones)
    
    print(f"\n{BOLD}🎯 MARGEN DE ERROR MEDIO: +/- {error_medio:.1f} días{RESET}")
    print(f"{BOLD}📈 RENDIMIENTO (R2): {score_r2:.3f}{RESET}\n")
    
    joblib.dump(modelo, 'modelo_estancia_v4.pkl', compress=3)
    print_success("Modelo Numérico Guardado en 'modelo_estancia_v4.pkl'.")

def main():
    print(f"\n{BOLD}{CYAN}==================================================================={RESET}")
    print(f"{BOLD}{CYAN}   🚀 SISTEMA PREDICTIVO V4 NUMÉRICO: REGRESIÓN EXACTA EN DÍAS     {RESET}")
    print(f"{BOLD}{CYAN}==================================================================={RESET}")
    try:
        df_bruto = load_data()
        df_limpio = preprocess_data(df_bruto)
        df_enriquecido = extract_comorbidities(df_limpio)
        X, y = build_features_and_target(df_enriquecido)
        train_and_evaluate(X, y)
        print(f"\n{BOLD}{GREEN}✅ Modelo de Regresión V4 Generado.{RESET}\n")
    except Exception as e:
        print_error(f"Error: {str(e)}")

if __name__ == '__main__':
    main()
