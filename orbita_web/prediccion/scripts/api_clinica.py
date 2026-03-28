import pandas as pd
import numpy as np
import joblib
import io
import os
import traceback
from fastapi import FastAPI, UploadFile, File, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Motor IA Clinica Sagrado Corazón - LOS", version="1.4.3")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_private_network_header(request, call_next):
    if request.method == "OPTIONS":
        if "access-control-request-private-network" in request.headers:
            response = Response()
            response.headers["Access-Control-Allow-Origin"] = "*"
            response.headers["Access-Control-Allow-Private-Network"] = "true"
            return response
    response = await call_next(request)
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response

# Rutas de Modelos
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)
MODELO_PATH = os.path.join(BASE_DIR, "modelos", "modelo_estancia_v4.pkl")
COLS_PATH = os.path.join(BASE_DIR, "modelos", "columnas_modelo_v4.pkl")

modelo_v4 = None
columnas_v4 = None

@app.on_event("startup")
def preload_models():
    global modelo_v4, columnas_v4
    try:
        if os.path.exists(MODELO_PATH): modelo_v4 = joblib.load(MODELO_PATH)
        if os.path.exists(COLS_PATH): columnas_v4 = joblib.load(COLS_PATH)
        print("✅ MOTOR IA SAGRADO CORAZON - INICIALIZADO V1.4.3")
    except Exception as e:
        print(f"❌ Error carga: {e}")

@app.post("/predict")
async def predict_api(file: UploadFile = File(...)):
    try:
        content = await file.read()
        if file.filename.endswith(('.csv', '.txt')):
            df = pd.read_csv(io.BytesIO(content), sep=None, engine='python', encoding='latin1')
        else:
            df = pd.read_excel(io.BytesIO(content))

        # 1. MAPEO ESTRICTO PARA EL FRONTEND (CORREGIDO DX1NOMBRE)
        df.columns = [str(c).strip() for c in df.columns]
        
        # Mapeo idéntico a los nombres en 'predictor-los.html'
        mapeo_clinica = {
            '#ing': 'Identificacion', 'TFCedu': 'Documento', 
            'Nombre1': 'Paciente_Nombre', 'Apellido1': 'Paciente_Apellido', 
            'EDAD': 'edad', 'Sexo': 'Sexo',
            'Estancia': 'Dias_Actuales', 'Cama': 'CAMA',
            'PabActual': 'PabellonIngreso', 'EspecTratante': 'Esp', 
            'Dx1': 'Dx_Code', 'Dx1Nombre': 'Dx1Nombre'
        }
        df_proc = df.rename(columns=mapeo_clinica)
        
        required = ['Paciente_Nombre', 'Paciente_Apellido', 'Dx1Nombre', 'edad', 'Sexo', 'PabellonIngreso', 'Esp', 'Dx_Code', 'Dias_Actuales']
        for r in required:
            if r not in df_proc.columns: df_proc[r] = "" if 'Nombre' in r or 'Dx1' in r else 0

        # 2. LOGICA CLINICA
        df_proc['edad'] = pd.to_numeric(df_proc['edad'], errors='coerce').fillna(50)
        df_proc['Dias_Actuales'] = pd.to_numeric(df_proc['Dias_Actuales'], errors='coerce').fillna(0)
        df_proc['Sexo'] = df_proc['Sexo'].astype(str).str.upper().str.strip().str[0].fillna('M')
        df_proc['Dx_Agrupado'] = df_proc['Dx_Code'].astype(str).str.strip().str[:4]
        
        # Comorbilidades
        dx_val = (df_proc['Dx1Nombre'].astype(str) + " " + df.get('Dx2Nombre', pd.Series(['']*len(df))).astype(str)).str.upper()
        pats = {'Diabetes': 'DIABETES', 'Hipertension': 'HTA|HIPERTEN', 'Cardiaca': 'FALLA|INFARTO|CARDIA', 'EPOC': 'EPOC', 'Renal': 'RENAL', 'VIH': 'VIH'}
        for col, p in pats.items():
            df_proc[col] = dx_str.str.contains(p).astype(int) if 'dx_str' in locals() else dx_val.str.contains(p).astype(int)
        
        df_proc['Total_Comorbilidades'] = df_proc[list(pats.keys())].sum(axis=1)

        # 3. PREDICCION
        features = ['edad', 'Sexo', 'PabellonIngreso', 'Esp', 'Dx_Agrupado', 'Diabetes', 'Hipertension', 'Cardiaca', 'EPOC', 'Renal', 'VIH', 'Total_Comorbilidades']
        X = pd.get_dummies(df_proc[features].loc[:, ~df_proc[features].columns.duplicated()])
        X = X.reindex(columns=columnas_v4, fill_value=0)
        
        preds = modelo_v4.predict(X)
        df_proc['Prediccion_Num'] = preds
        df_proc['Prediccion_Estancia'] = [f"{v:.1f} d" for v in preds]
        
        # CORRECCION FINAL DE LOGICA EN ESTADO_AUDITORIA
        df_proc['Estado_Auditoria'] = np.where(df_proc['Dias_Actuales'] > df_proc['Prediccion_Num'], "⚠️ Desviación", "✅ Normal")

        return {
            "status": "success",
            "kpis": {
                "total_pacientes": len(df_proc),
                "desviados": int(sum(df_proc['Dias_Actuales'] > df_proc['Prediccion_Num'])),
                "riesgo_prolongado": int(sum(df_proc['Prediccion_Num'] > 8))
            },
            "pacientes": df_proc.fillna('').to_dict(orient='records')
        }
    except Exception as e:
        print("❌ ERROR DE LOGICA (v1.4.3) DETECTADO:")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health():
    return {"status": "IA Sagrado Corazon Online", "v": "1.4.3", "ready": modelo_v4 is not None}

@app.get("/")
async def root():
    return {"message": "Motor IA Clinica Sagrado Corazon"}
