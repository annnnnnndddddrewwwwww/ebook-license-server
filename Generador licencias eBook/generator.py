import customtkinter as ctk
from tkinter import messagebox
import requests
import json
import threading
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

# --- Configuration ---
# IMPORTANT: Replace with the actual URL of your server.js
SERVER_URL = 'https://mi-ebook-licencias-api.onrender.com' # Your server URL (example)

# --- Email Configuration ---
# You NEED to use an App Password for Gmail if you have 2FA enabled.
# Go to myaccount.google.com/apppasswords to generate one.
SMTP_SERVER = 'smtp.gmail.com'
SMTP_PORT = 587
SENDER_EMAIL = 'noreplyebookeva@gmail.com' # Your dedicated sending email address
SENDER_PASSWORD = 'YOUR_APP_PASSWORD_HERE' # <<< VERY IMPORTANT: REPLACE WITH YOUR GMAIL APP PASSWORD

# --- CustomTkinter Setup ---
ctk.set_appearance_mode("System")  # Modes: "System" (default), "Dark", "Light"
ctk.set_default_color_theme("blue")  # Themes: "blue" (default), "dark-blue", "green"

# --- Helper Functions for API Calls ---

def make_request(method, endpoint, data=None):
    url = f"{SERVER_URL}/{endpoint}"
    headers = {'Content-Type': 'application/json'}
    try:
        if method == 'GET':
            response = requests.get(url, headers=headers, timeout=10)
        elif method == 'POST':
            response = requests.post(url, headers=headers, data=json.dumps(data), timeout=10)
        else:
            raise ValueError("Unsupported HTTP method")

        response.raise_for_status()  # Raise HTTPError for bad responses (4xx or 5xx)
        return response.json()
    except requests.exceptions.ConnectionError:
        messagebox.showerror("Error de Conexión", f"No se pudo conectar al servidor en {SERVER_URL}. Asegúrate de que el servidor esté funcionando y la URL sea correcta.")
        return None
    except requests.exceptions.Timeout:
        messagebox.showerror("Error de Tiempo de Espera", "La solicitud al servidor ha tardado demasiado. Por favor, intenta de nuevo.")
        return None
    except requests.exceptions.HTTPError as err:
        try:
            error_message = err.response.json().get('message', str(err))
        except json.JSONDecodeError:
            error_message = err.response.text
        messagebox.showerror("Error del Servidor", f"Error del servidor: {err.response.status_code} - {error_message}")
        return None
    except Exception as err:
        messagebox.showerror("Error Desconocido", f"Ocurrió un error inesperado: {err}")
        return None

# --- Main Application Functions ---

# --- License Tab ---
def generate_license_trigger():
    max_ips_str = max_ips_entry.get()

    if not max_ips_str:
        messagebox.showwarning("Campo Vacío", "Por favor, ingresa el número máximo de IPs.")
        return

    try:
        max_ips = int(max_ips_str)
        if max_ips < 1:
            raise ValueError("El número de IPs debe ser al menos 1.")
    except ValueError as e:
        messagebox.showwarning("Entrada Inválida", f"Máximo de IPs debe ser un número entero positivo. {e}")
        return

    threading.Thread(target=generate_license_async, args=(max_ips, False)).start() # Pass False for email_send_mode

def generate_license_async(max_ips, email_send_mode=False):
    # email_send_mode helps decide whether to show a messagebox or just return the license
    result = make_request('POST', 'generate-license', {'maxIPs': max_ips})
    if result and result.get('success'):
        if not email_send_mode:
            messagebox.showinfo("Éxito", result.get('message', 'Licencia generada con éxito.'))
        # Clear fields and refresh data
        max_ips_entry.delete(0, ctk.END)
        refresh_data_trigger()
        return result['licenseKey'] # Return the generated license key
    elif result and not email_send_mode:
        messagebox.showerror("Error al Generar", result.get('message', 'Fallo al generar la licencia.'))
        return None
    elif not result and email_send_mode:
        # Error already handled by make_request if result is None
        return None
    return None # Fallback

# --- Data View Tab ---
def refresh_data_trigger():
    threading.Thread(target=refresh_data_async).start()

def refresh_data_async():
    licenses_data = make_request('GET', 'licenses')
    root.after(0, lambda: update_data_display(licenses_data))

def update_data_display(licenses_data):
    # Clear previous data
    for widget in licenses_frame.winfo_children():
        widget.destroy()

    # Display Licenses
    ctk.CTkLabel(licenses_frame, text="LICENCIAS REGISTRADAS", font=ctk.CTkFont(size=18, weight="bold")).pack(pady=10)
    if licenses_data and licenses_data.get('success') and licenses_data['licenses']:
        # Header Row: LicenseKey, MaxIPs, UsedIPs, ExpiryDate
        ctk.CTkLabel(licenses_frame, text=f"{'Clave Licencia':<20} | {'Max IPs':<10} | {'IPs Usadas':<35} | {'Expira en':<20}", font=ctk.CTkFont(weight="bold")).pack(anchor="w")
        for lic in licenses_data['licenses']:
            # Asegúrate de que los campos existan en la respuesta del servidor
            license_key = lic.get('licenseKey', 'N/A')
            max_ips = lic.get('maxIPs', 'N/A')
            used_ips = ", ".join(lic.get('usedIPs', [])) if lic.get('usedIPs') else 'Ninguna'
            expires_at = lic.get('expiresAt', 'N/A').split('T')[0]

            ctk.CTkLabel(licenses_frame, text=f"{license_key:<20} | {str(max_ips):<10} | {used_ips:<35} | {expires_at:<20}").pack(anchor="w")
    else:
        ctk.CTkLabel(licenses_frame, text="No hay licencias registradas.", font=ctk.CTkFont(slant="italic")).pack(pady=5)

# --- Maintenance Tab ---
current_maintenance_state = False # Initial state, will be updated from server

def get_maintenance_status_trigger():
    threading.Thread(target=get_maintenance_status_async).start()

def get_maintenance_status_async():
    global current_maintenance_state
    result = make_request('GET', 'get-maintenance-status')
    if result:
        current_maintenance_state = result.get('maintenanceMode', False)
        root.after(0, update_maintenance_ui)

def toggle_maintenance_trigger():
    threading.Thread(target=toggle_maintenance_async).start()

def toggle_maintenance_async():
    global current_maintenance_state
    new_state = not current_maintenance_state
    result = make_request('POST', 'set-maintenance-mode', {'maintenanceMode': new_state})
    if result and result.get('success'):
        current_maintenance_state = new_state
        root.after(0, update_maintenance_ui)
        messagebox.showinfo("Éxito", result.get('message', f"Modo de mantenimiento cambiado a {new_state}"))
    elif result:
        messagebox.showerror("Error", result.get('message', "Fallo al cambiar el modo de mantenimiento."))

def update_maintenance_ui():
    status_text = "ACTIVO" if current_maintenance_state else "INACTIVO"
    color = "red" if current_maintenance_state else "green"
    button_text = "Desactivar Modo Mantenimiento" if current_maintenance_state else "Activar Modo Mantenimiento"
    button_color = "red" if current_maintenance_state else "green"

    maintenance_status_label.configure(text=f"Modo Mantenimiento: {status_text}", text_color=color)
    maintenance_toggle_button.configure(text=button_text, fg_color=button_color, hover_color=color)

# --- Email Tab Functions ---
def send_email_trigger():
    # Get recipients from the text box
    raw_recipients = email_recipients_textbox.get("1.0", ctk.END).strip()
    # Split by newline, filter out empty lines, and strip whitespace from each email
    selected_recipients = [email.strip() for email in raw_recipients.split('\n') if email.strip()]

    email_subject = email_subject_entry.get()
    email_body_text = email_body_textbox.get("1.0", ctk.END).strip()
    max_ips_email_str = max_ips_email_entry.get()

    if not selected_recipients:
        messagebox.showwarning("Destinatarios Vacíos", "Por favor, ingresa al menos un destinatario en el cuadro de texto.")
        return
    if not email_subject or not email_body_text or not max_ips_email_str:
        messagebox.showwarning("Campos Vacíos", "Por favor, completa el asunto, el mensaje y el número máximo de IPs.")
        return

    try:
        max_ips_email = int(max_ips_email_str)
        if max_ips_email < 1:
            raise ValueError("El número de IPs debe ser al menos 1.")
    except ValueError as e:
        messagebox.showwarning("Entrada Inválida", f"Máximo de IPs para la licencia debe ser un número entero positivo. {e}")
        return

    # Confirm before sending to multiple recipients
    if len(selected_recipients) > 1:
        confirm = messagebox.askyesno("Confirmar Envío Múltiple",
                                      f"Estás a punto de enviar {len(selected_recipients)} correos. ¿Confirmas el envío?",
                                      icon='warning')
        if not confirm:
            return

    # Start a thread to send emails
    threading.Thread(target=send_emails_async, args=(selected_recipients, email_subject, email_body_text, max_ips_email)).start()

def send_emails_async(recipients, subject, body_text, max_ips_for_license):
    sent_count = 0
    failed_count = 0
    failed_recipients = []

    for recipient in recipients:
        try:
            # 1. Generate a new license for each email
            license_key = generate_license_async(max_ips_for_license, email_send_mode=True)
            if not license_key:
                # Error message already shown by generate_license_async if it failed
                failed_count += 1
                failed_recipients.append(recipient)
                continue # Skip to the next recipient

            full_body_html = f"""
            <html>
            <head></head>
            <body>
                <p>Estimado cliente,</p>
                <p>Aquí tiene su nueva clave de licencia para nuestro ebook:</p>
                <p><strong>Clave de Licencia:</strong> <code>{license_key}</code></p>
                <p>A continuación, encontrará el mensaje adicional:</p>
                <hr>
                <p>{body_text.replace('\\n', '<br>')}</p>
                <hr>
                <p>Gracias por su compra.</p>
                <p>Atentamente,<br>Su Equipo de Soporte</p>
            </body>
            </html>
            """

            msg = MIMEMultipart('alternative')
            msg['From'] = SENDER_EMAIL
            msg['To'] = recipient
            msg['Subject'] = subject

            msg.attach(MIMEText(body_text, 'plain'))
            msg.attach(MIMEText(full_body_html, 'html'))

            with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
                server.starttls()
                server.login(SENDER_EMAIL, SENDER_PASSWORD)
                server.send_message(msg)
            sent_count += 1
        except smtplib.SMTPAuthenticationError:
            messagebox.showerror("Error de Autenticación", f"Fallo al autenticarse con el servidor SMTP para {recipient}. Verifica tu correo y contraseña.")
            failed_count += 1
            failed_recipients.append(recipient)
        except smtplib.SMTPConnectError:
            messagebox.showerror("Error de Conexión SMTP", f"No se pudo conectar al servidor SMTP para {recipient}. Verifica la dirección del servidor y el puerto.")
            failed_count += 1
            failed_recipients.append(recipient)
        except Exception as e:
            messagebox.showerror("Error al Enviar Correo", f"Ocurrió un error inesperado al enviar correo a {recipient}: {e}")
            failed_count += 1
            failed_recipients.append(recipient)

    root.after(0, lambda: show_email_summary(sent_count, failed_count, failed_recipients))


def show_email_summary(sent, failed, failed_list):
    summary_message = f"Envío de correos completado:\n\n"
    summary_message += f"Enviados con éxito: {sent}\n"
    summary_message += f"Fallidos: {failed}\n"
    if failed > 0:
        summary_message += "Destinatarios fallidos:\n" + "\n".join(failed_list)
    messagebox.showinfo("Resumen de Envío", summary_message)

    # Clear email fields
    root.after(0, lambda: email_subject_entry.delete(0, ctk.END))
    root.after(0, lambda: email_body_textbox.delete("1.0", ctk.END))
    root.after(0, lambda: max_ips_email_entry.delete(0, ctk.END))
    root.after(0, lambda: email_recipients_textbox.delete("1.0", ctk.END)) # Clear recipients box


# --- UI Setup ---
root = ctk.CTk()
root.title("Administración de Licencias Ebook (IPs)")
root.geometry("1100x750") # Adjusted height back as no checkboxes list anymore

# Tabs
tabview = ctk.CTkTabview(root)
tabview.pack(padx=20, pady=20, expand=True, fill="both")

license_tab = tabview.add("Generar Licencia")
data_tab = tabview.add("Ver Licencias")
maintenance_tab = tabview.add("Modo Mantenimiento")
email_tab = tabview.add("Enviar Correo") # Email Tab

# --- Generar Licencia Tab Content ---
ctk.CTkLabel(license_tab, text="GENERAR NUEVA LICENCIA", font=ctk.CTkFont(size=20, weight="bold")).pack(pady=20)

ctk.CTkLabel(license_tab, text="Número Máximo de IPs Permitidas:").pack(pady=(10, 0))
max_ips_entry = ctk.CTkEntry(license_tab, width=300, placeholder_text="Ej: 3 (para 3 IPs simultáneas)")
max_ips_entry.pack(pady=5)

generate_button = ctk.CTkButton(license_tab, text="Generar y Registrar Licencia (Manual)", command=generate_license_trigger)
generate_button.pack(pady=20)
ctk.CTkLabel(license_tab, text="Nota: Para generar y enviar por correo, usa la pestaña 'Enviar Correo'.", text_color="gray").pack(pady=5)

# --- Ver Datos Tab Content ---
data_frame = ctk.CTkScrollableFrame(data_tab, label_text="Datos de Licencias del Servidor", corner_radius=10)
data_frame.pack(padx=10, pady=10, expand=True, fill="both")

licenses_frame = ctk.CTkFrame(data_frame, fg_color="transparent")
licenses_frame.pack(pady=10, fill="x", expand=False)

refresh_button = ctk.CTkButton(data_tab, text="Actualizar Datos de Licencias", command=refresh_data_trigger)
refresh_button.pack(pady=10)

# --- Modo Mantenimiento Tab Content ---
maintenance_status_label = ctk.CTkLabel(maintenance_tab, text="Modo Mantenimiento: DESCONOCIDO",
                                         font=ctk.CTkFont(size=18, weight="bold"),
                                         text_color="gray")
maintenance_status_label.pack(pady=30)

maintenance_toggle_button = ctk.CTkButton(maintenance_tab,
                                          text="Cargando Estado...",
                                          command=toggle_maintenance_trigger,
                                          fg_color="gray",
                                          hover_color="darkgray",
                                          width=250, height=50,
                                          font=ctk.CTkFont(size=15, weight="bold"))
maintenance_toggle_button.pack(pady=20)

ctk.CTkButton(maintenance_tab, text="Actualizar Estado Manualmente", command=get_maintenance_status_trigger,
              fg_color="transparent", text_color=ctk.get_appearance_mode().capitalize() if ctk.get_appearance_mode() == "Dark" else "gray",
              hover_color=ctk.get_appearance_mode().capitalize() if ctk.get_appearance_mode() == "Dark" else "lightgray",
              font=ctk.CTkFont(size=12)).pack(pady=10)

# --- Email Tab Content ---
ctk.CTkLabel(email_tab, text="ENVIAR CORREO CON LICENCIA", font=ctk.CTkFont(size=20, weight="bold")).pack(pady=20)

# Manual Recipient Email Textbox
ctk.CTkLabel(email_tab, text="Ingresa los correos de los destinatarios (uno por línea):").pack(pady=(10, 0))
email_recipients_textbox = ctk.CTkTextbox(email_tab, width=500, height=120, wrap="word") # Removed placeholder_text
email_recipients_textbox.pack(pady=5)

# Subject
ctk.CTkLabel(email_tab, text="Asunto del Correo:").pack(pady=(10, 0))
email_subject_entry = ctk.CTkEntry(email_tab, width=500, placeholder_text="Su Nueva Licencia Ebook")
email_subject_entry.pack(pady=5)

# Max IPs for the License to be generated for this email
ctk.CTkLabel(email_tab, text="Máximo de IPs para la licencia a generar (para cada correo):").pack(pady=(10, 0))
max_ips_email_entry = ctk.CTkEntry(email_tab, width=200, placeholder_text="Ej: 5")
max_ips_email_entry.pack(pady=5)

# Email Body
ctk.CTkLabel(email_tab, text="Mensaje Adicional (Será incluido en el correo):").pack(pady=(10, 0))
email_body_textbox = ctk.CTkTextbox(email_tab, width=500, height=120, wrap="word")
email_body_textbox.pack(pady=5)

# Send Button
send_email_button = ctk.CTkButton(email_tab, text="Generar Licencias y Enviar Correos", command=send_email_trigger)
send_email_button.pack(pady=20)


# Initialize maintenance mode status when app starts (in a thread)
root.after(100, get_maintenance_status_trigger) # Run after 100ms

# Initial data load
root.after(100, refresh_data_trigger) # Load licenses data after a short delay

root.mainloop()