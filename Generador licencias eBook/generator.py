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

    threading.Thread(target=generate_license_async, args=(max_ips,)).start()

def generate_license_async(max_ips):
    result = make_request('POST', 'generate-license', {'maxIPs': max_ips})
    if result and result.get('success'):
        ctk.CTkLabel(license_tab, text=f"Licencia generada: {result['licenseKey']}", font=ctk.CTkFont(size=16, weight="bold"), text_color="green").pack(pady=10)
        messagebox.showinfo("Éxito", result.get('message', 'Licencia generada con éxito.'))
        # Clear fields and refresh data
        max_ips_entry.delete(0, ctk.END)
        refresh_data_trigger()
    elif result:
        messagebox.showerror("Error al Generar", result.get('message', 'Fallo al generar la licencia.'))

# --- Data View Tab ---
def refresh_data_trigger():
    threading.Thread(target=refresh_data_async).start()

def refresh_data_async():
    licenses_data = make_request('GET', 'licenses')
    # Ya no solicitamos datos de usuarios si no los vamos a mostrar
    # users_data = make_request('GET', 'users')

    root.after(0, lambda: update_data_display(licenses_data))

def update_data_display(licenses_data):
    # Clear previous data
    for widget in licenses_frame.winfo_children():
        widget.destroy()
    # No hay necesidad de limpiar users_frame si lo eliminamos

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

    # NO MOSTRAMOS LA SECCIÓN DE USUARIOS REGISTRADOS
    # for widget in users_frame.winfo_children():
    #     widget.destroy()
    # ctk.CTkLabel(users_frame, text="USUARIOS REGISTRADOS", font=ctk.CTkFont(size=18, weight="bold")).pack(pady=10)
    # ctk.CTkLabel(users_frame, text="La gestión de usuarios ha sido eliminada de esta interfaz.", font=ctk.CTkFont(slant="italic")).pack(pady=5)


# --- Maintenance Tab ---
current_maintenance_state = False # Initial state, will be updated from server

def get_maintenance_status_trigger():
    threading.Thread(target=get_maintenance_status_async).start()

def get_maintenance_status_async():
    global current_maintenance_state # MOVED TO THE TOP
    result = make_request('GET', 'get-maintenance-status')
    if result:
        current_maintenance_state = result.get('maintenanceMode', False)
        root.after(0, update_maintenance_ui)

def toggle_maintenance_trigger():
    threading.Thread(target=toggle_maintenance_async).start()

def toggle_maintenance_async():
    global current_maintenance_state # MOVED TO THE TOP
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
root.title("Administración de Licencias Ebook (IPs)")
root.geometry("1000x700") # Increased width to accommodate new column

# Tabs
tabview = ctk.CTkTabview(root)
tabview.pack(padx=20, pady=20, expand=True, fill="both")

license_tab = tabview.add("Generar Licencia")
data_tab = tabview.add("Ver Licencias") # Renamed tab
maintenance_tab = tabview.add("Modo Mantenimiento")

# --- Generar Licencia Tab Content ---
ctk.CTkLabel(license_tab, text="GENERAR NUEVA LICENCIA", font=ctk.CTkFont(size=20, weight="bold")).pack(pady=20)

ctk.CTkLabel(license_tab, text="Número Máximo de IPs Permitidas:").pack(pady=(10, 0))
max_ips_entry = ctk.CTkEntry(license_tab, width=300, placeholder_text="Ej: 3 (para 3 IPs simultáneas)")
max_ips_entry.pack(pady=5)

generate_button = ctk.CTkButton(license_tab, text="Generar y Registrar Licencia", command=generate_license_trigger)
generate_button.pack(pady=20)

# --- Ver Datos Tab Content ---
data_frame = ctk.CTkScrollableFrame(data_tab, label_text="Datos de Licencias del Servidor", corner_radius=10)
data_frame.pack(padx=10, pady=10, expand=True, fill="both")

licenses_frame = ctk.CTkFrame(data_frame, fg_color="transparent")
licenses_frame.pack(pady=10, fill="x", expand=False)

# Ya no necesitamos users_frame si eliminamos la sección de usuarios
# users_frame = ctk.CTkFrame(data_frame, fg_color="transparent")
# users_frame.pack(pady=10, fill="x", expand=False)

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


# Initialize maintenance mode status when app starts (in a thread)
root.after(100, get_maintenance_status_trigger) # Run after 100ms

# Initial data load
root.after(100, refresh_data_trigger) # Load data after a short delay

root.mainloop()