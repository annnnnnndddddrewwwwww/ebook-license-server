import os
import pickle
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from dotenv import load_dotenv

load_dotenv() # Carga las variables de entorno

SCOPES = ['https://www.googleapis.com/auth/gmail.send']
TOKEN_FILE_NAME = os.getenv('TOKEN_FILE_NAME', 'token.json')
CLIENT_SECRET_FILE = 'client_secret.json' # Archivo temporal para credenciales


def get_gmail_credentials():
    """
    Obtiene las credenciales de Gmail, manejando la autenticación OAuth2.
    Si no hay credenciales guardadas o son inválidas, inicia el flujo de autorización.
    """
    creds = None
    # El archivo token.json almacena los tokens de acceso y actualización del usuario
    # y se crea automáticamente cuando el flujo de autorización se completa por primera vez.
    if os.path.exists(TOKEN_FILE_NAME):
        with open(TOKEN_FILE_NAME, 'rb') as token:
            creds = pickle.load(token)

    # Si no hay credenciales válidas disponibles, inicia el flujo de autorización.
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            # Crea un archivo client_secret.json temporal con las credenciales del .env
            # Esto es necesario para InstalledAppFlow.from_client_secrets_file
            client_id = os.getenv('GOOGLE_CLIENT_ID')
            client_secret = os.getenv('GOOGLE_CLIENT_SECRET')

            if not client_id or not client_secret:
                raise ValueError("GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET deben estar definidos en el archivo .env")

            client_config = {
                "installed": {
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                    "redirect_uris": ["urn:ietf:wg:oauth:2.0:oob", "http://localhost"]
                }
            }
            # Guarda la configuración en un archivo temporal
            with open(CLIENT_SECRET_FILE, 'w') as f:
                import json
                json.dump(client_config, f)

            flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRET_FILE, SCOPES)
            creds = flow.run_local_server(port=0) # Abre una ventana del navegador para la autenticación

            # Elimina el archivo client_secret.json temporal
            if os.path.exists(CLIENT_SECRET_FILE):
                os.remove(CLIENT_SECRET_FILE)

        # Guarda las credenciales para la próxima ejecución
        with open(TOKEN_FILE_NAME, 'wb') as token:
            pickle.dump(creds, token)
    return creds

if __name__ == '__main__':
    # Este bloque solo se ejecuta si corres este script directamente.
    # Es útil para probar y obtener el token inicial.
    try:
        print("Intentando obtener credenciales de Gmail...")
        creds = get_gmail_credentials()
        print("Credenciales obtenidas con éxito.")
        print(f"Token de actualización guardado en: {TOKEN_FILE_NAME}")
    except Exception as e:
        print(f"Error al obtener credenciales: {e}")

