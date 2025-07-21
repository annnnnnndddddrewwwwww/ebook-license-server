import customtkinter as ctk
from tkinter import messagebox
import requests
import json
import threading

# --- Configuration ---
# IMPORTANT: Replace with the actual URL of your server.js
SERVER_URL = 'https://mi-ebook-licencias-api.onrender.com' # Your server URL (example)

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
    user_name = name_entry.get()
    user_email = email_entry.get()

    if not user_name or not user_email:
        messagebox.showwarning("Campos Vacíos", "Por favor, ingresa el nombre de usuario y el correo electrónico.")
        return

    threading.Thread(target=generate_license_async, args=(user_name, user_email)).start()

def generate_license_async(user_name, user_email):
    result = make_request('POST', 'generate-license', {'userName': user_name, 'userEmail': user_email})
    if result and result.get('success'):
        ctk.CTkLabel(license_tab, text=f"Licencia generada: {result['licenseKey']}", font=ctk.CTkFont(size=16, weight="bold"), text_color="green").pack(pady=10)
        messagebox.showinfo("Éxito", result.get('message', 'Licencia generada con éxito.'))
        # Clear fields and refresh data
        name_entry.delete(0, ctk.END)
        email_entry.delete(0, ctk.END)
        refresh_data_trigger()
    elif result:
        messagebox.showerror("Error al Generar", result.get('message', 'Fallo al generar la licencia.'))

# --- Data View Tab ---
def refresh_data_trigger():
    threading.Thread(target=refresh_data_async).start()

def refresh_data_async():
    licenses_data = make_request('GET', 'licenses')
    users_data = make_request('GET', 'users')

    root.after(0, lambda: update_data_display(licenses_data, users_data))

def update_data_display(licenses_data, users_data):
    # Clear previous data
    for widget in licenses_frame.winfo_children():
        widget.destroy()
    for widget in users_frame.winfo_children():
        widget.destroy()

    # Display Licenses
    ctk.CTkLabel(licenses_frame, text="LICENCIAS REGISTRADAS", font=ctk.CTkFont(size=18, weight="bold")).pack(pady=10)
    if licenses_data and licenses_data.get('success') and licenses_data['licenses']:
        # Header Row
        ctk.CTkLabel(licenses_frame, text=f"{'Clave Licencia':<20} | {'Usuario':<20} | {'Email':<25} | {'Generado en':<20} | {'Expira en':<20}", font=ctk.CTkFont(weight="bold")).pack(anchor="w")
        for lic in licenses_data['licenses']:
            ctk.CTkLabel(licenses_frame, text=f"{lic['licenseKey']:<20} | {lic['userName']:<20} | {lic['userEmail']:<25} | {lic['generatedAt'].split('T')[0]:<20} | {lic['expiresAt'].split('T')[0]:<20}").pack(anchor="w")
    else:
        ctk.CTkLabel(licenses_frame, text="No hay licencias registradas.", font=ctk.CTkFont(slant="italic")).pack(pady=5)

    # Display Users
    ctk.CTkLabel(users_frame, text="USUARIOS REGISTRADOS", font=ctk.CTkFont(size=18, weight="bold")).pack(pady=10)
    if users_data and users_data.get('success') and users_data['users']:
        # Header Row
        ctk.CTkLabel(users_frame, text=f"{'Usuario':<20} | {'Email':<25} | {'Registrado en':<20} | {'Email Bienvenida Enviado':<25}", font=ctk.CTkFont(weight="bold")).pack(anchor="w")
        for user in users_data['users']:
            welcome_status = "Sí" if user.get('welcomeEmailSent') == 'true' else "No"
            ctk.CTkLabel(users_frame, text=f"{user['userName']:<20} | {user['userEmail']:<25} | {user['registeredAt'].split('T')[0]:<20} | {welcome_status:<25}").pack(anchor="w")
    else:
        ctk.CTkLabel(users_frame, text="No hay usuarios registrados.", font=ctk.CTkFont(slant="italic")).pack(pady=5)

# --- Maintenance Tab ---
def get_maintenance_status_trigger():
    threading.Thread(target=get_maintenance_status_async).start()

def get_maintenance_status_async():
    global current_maintenance_state # <--- MOVED TO THE TOP
    result = make_request('GET', 'get-maintenance-status')
    if result:
        current_maintenance_state = result.get('maintenanceMode', False)
        root.after(0, update_maintenance_ui)

def toggle_maintenance_trigger():
    threading.Thread(target=toggle_maintenance_async).start()

def toggle_maintenance_async():
    global current_maintenance_state # <--- MOVED TO THE TOP
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
    maintenance_toggle_button.configure(text=button_text, fg_color=button_color, hover_color=color) # Hover color should be consistent

# --- UI Setup ---
root = ctk.CTk()
root.title("Administración de Licencias y Usuarios Ebook")
root.geometry("1000x700") # Increased width to accommodate new column

# Tabs
tabview = ctk.CTkTabview(root)
tabview.pack(padx=20, pady=20, expand=True, fill="both")

license_tab = tabview.add("Generar Licencia")
data_tab = tabview.add("Ver Datos")
maintenance_tab = tabview.add("Modo Mantenimiento")

# --- Generar Licencia Tab Content ---
ctk.CTkLabel(license_tab, text="GENERAR NUEVA LICENCIA", font=ctk.CTkFont(size=20, weight="bold")).pack(pady=20)

ctk.CTkLabel(license_tab, text="Nombre de Usuario:").pack(pady=(10, 0))
name_entry = ctk.CTkEntry(license_tab, width=300, placeholder_text="Nombre Completo")
name_entry.pack(pady=5)

ctk.CTkLabel(license_tab, text="Correo Electrónico:").pack(pady=(10, 0))
email_entry = ctk.CTkEntry(license_tab, width=300, placeholder_text="correo@ejemplo.com")
email_entry.pack(pady=5)

generate_button = ctk.CTkButton(license_tab, text="Generar y Registrar Licencia", command=generate_license_trigger)
generate_button.pack(pady=20)

# --- Ver Datos Tab Content ---
data_frame = ctk.CTkScrollableFrame(data_tab, label_text="Datos del Servidor", corner_radius=10)
data_frame.pack(padx=10, pady=10, expand=True, fill="both")

licenses_frame = ctk.CTkFrame(data_frame, fg_color="transparent")
licenses_frame.pack(pady=10, fill="x", expand=False)

users_frame = ctk.CTkFrame(data_frame, fg_color="transparent")
users_frame.pack(pady=10, fill="x", expand=False)

refresh_button = ctk.CTkButton(data_tab, text="Actualizar Datos", command=refresh_data_trigger)
refresh_button.pack(pady=10)

# --- Modo Mantenimiento Tab Content ---
current_maintenance_state = False # Initial state, will be updated from server

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


# Initialize maintenance mode status when app starts (in a thread)
root.after(100, get_maintenance_status_trigger) # Run after 100ms

# Initial data load
root.after(100, refresh_data_trigger) # Load data after a short delay

root.mainloop()