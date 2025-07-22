import os
import requests
from google_auth_util import get_gmail_credentials
from googleapiclient.discovery import build
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
import base64
from dotenv import load_dotenv

load_dotenv()

LICENSE_SERVER_BASE_URL = os.getenv('LICENSE_SERVER_BASE_URL')
SENDER_EMAIL = os.getenv('SENDER_EMAIL')

class EmailMarketingApp:
    def __init__(self):
        if not LICENSE_SERVER_BASE_URL:
            raise ValueError("LICENSE_SERVER_BASE_URL no está configurado en .env")
        if not SENDER_EMAIL:
            raise ValueError("SENDER_EMAIL no está configurado en .env")

        self.service = self._authenticate_gmail()

    def _authenticate_gmail(self):
        """Autentica con la API de Gmail y devuelve el servicio."""
        try:
            creds = get_gmail_credentials()
            service = build('gmail', 'v1', credentials=creds)
            return service
        except Exception as e:
            print(f"Error al autenticar con Gmail: {e}")
            return None

    def get_registered_emails(self):
        """Obtiene la lista de correos electrónicos de usuarios registrados desde el servidor de licencias."""
        try:
            response = requests.get(f"{LICENSE_SERVER_BASE_URL}/users")
            response.raise_for_status() # Lanza un error para códigos de estado HTTP 4xx/5xx
            data = response.json()
            if data.get('success') and data.get('emails'):
                # Asegura que solo se obtengan emails únicos y válidos
                emails = [email for email in data['emails'] if email and '@' in email and '.' in email]
                return list(set(emails)) # Elimina duplicados finales
            else:
                print(f"Advertencia: No se encontraron emails o la respuesta no es exitosa: {data.get('message', 'Sin mensaje')}")
                return []
        except requests.exceptions.RequestException as e:
            print(f"Error de red o servidor al obtener emails: {e}")
            return []
        except ValueError as e:
            print(f"Error al parsear JSON: {e}")
            return []

    def send_email(self, recipients, subject, html_body):
        """
        Envía un correo electrónico a múltiples destinatarios.
        :param recipients: Lista de direcciones de correo electrónico.
        :param subject: Asunto del correo.
        :param html_body: Cuerpo del correo en formato HTML.
        :return: True si se envió con éxito, False en caso contrario.
        """
        if not self.service:
            print("Servicio de Gmail no autenticado. No se puede enviar el correo.")
            return False

        if not recipients:
            print("No se proporcionaron destinatarios.")
            return False

        try:
            message = MIMEMultipart('alternative')
            message['to'] = ", ".join(recipients)
            message['from'] = SENDER_EMAIL
            message['subject'] = subject

            # Añade el cuerpo HTML
            part1 = MIMEText(html_body, 'html')
            message.attach(part1)

            # Codifica el mensaje para la API de Gmail
            raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode()
            body = {'raw': raw_message}

            # Envía el correo
            sent_message = self.service.users().messages().send(userId='me', body=body).execute()
            print(f"Correo enviado. ID del mensaje: {sent_message['id']}")
            return True
        except Exception as e:
            print(f"Error al enviar correo: {e}")
            return False

# Ejemplo de uso (solo para pruebas directas del módulo)
if __name__ == '__main__':
    app_logic = EmailMarketingApp()
    emails = app_logic.get_registered_emails()
    if emails:
        print(f"Emails registrados: {emails}")
        # Puedes enviar un correo de prueba aquí:
        # success = app_logic.send_email(
        #     recipients=emails[:1], # Envía solo al primer email para probar
        #     subject="[Prueba] Saludos desde tu App de Python",
        #     html_body="""
        #     <h2 style="color:#4A729E;">¡Hola desde Python!</h2>
        #     <p>Este es un mensaje de prueba enviado desde tu aplicación CustomTkinter.</p>
        #     <p>Saludos,</p>
        #     <p>Tu App</p>
        #     """
        # )
        # if success:
        #     print("Correo de prueba enviado.")
        # else:
        #     print("Fallo al enviar el correo de prueba.")
    else:
        print("No se pudieron obtener correos electrónicos registrados.")

