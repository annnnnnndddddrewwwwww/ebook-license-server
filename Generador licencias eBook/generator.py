import customtkinter as ctk
from tkinter import messagebox
import requests
import json
import threading # For non-blocking UI during API calls

# --- Configuration ---
# IMPORTANT: Replace with the actual URL of your server.js
SERVER_URL = 'https://mi-ebook-licencias-api.onrender.com' # Your server URL

# --- CustomTkinter Setup ---
ctk.set_appearance_mode("System")  # Modes: "System" (default), "Dark", "Light"
ctk.set_default_color_theme("blue")  # Themes: "blue" (default), "dark-blue", "green"

# --- Helper Functions for API Calls ---

def make_request(method, endpoint, data=None):
    url = f"{SERVER_URL}/{endpoint}"
    headers = {'Content-Type': 'application/json'}
    try:
        if method == 'GET':
            response = requests.get(url, headers=headers, timeout=10) # Added timeout
        elif method == 'POST':
            response = requests.post(url, headers=headers, data=json.dumps(data), timeout=10) # Added timeout
        else:
            raise ValueError("Unsupported HTTP method")

        response.raise_for_status()  # Raise HTTPError for bad responses (4xx or 5xx)
        return response.json()
    except requests.exceptions.ConnectionError:
        messagebox.showerror("Error de Conexión", f"No se pudo conectar al servidor en {SERVER_URL}. Asegúrate de que el servidor esté ejecutándose.")
        return None
    except requests.exceptions.Timeout:
        messagebox.showerror("Tiempo de Espera", "La solicitud al servidor tardó demasiado. Inténtalo de nuevo.")
        return None
    except requests.exceptions.HTTPError as http_err:
        try:
            error_details = response.json()
            messagebox.showerror("Error del Servidor", f"HTTP {response.status_code}: {error_details.get('message', 'Error desconocido del servidor.')}")
        except json.JSONDecodeError:
            messagebox.showerror("Error del Servidor", f"HTTP {response.status_code}: {http_err}. Respuesta no JSON: {response.text}")
        return None
    except Exception as err:
        messagebox.showerror("Error Inesperado", f"Ocurrió un error inesperado: {err}")
        return None

def generate_license_api(max_ips):
    data = {'maxUniqueIps': max_ips}
    return make_request('POST', 'generate-license', data)

def invalidate_license_api(license_key):
    data = {'license': license_key}
    return make_request('POST', 'invalidate-license', data)

def get_licenses_api():
    return make_request('GET', 'licenses')

def get_users_api():
    return make_request('GET', 'users')

def set_maintenance_mode_api(state):
    data = {'maintenanceMode': state}
    return make_request('POST', 'set-maintenance-mode', data)

def get_maintenance_status_api():
    return make_request('GET', 'get-maintenance-status')

# --- GUI Functions (Wrapped for Threading) ---

def run_in_thread(func, *args):
    """Runs a function in a separate thread to prevent UI freezing."""
    threading.Thread(target=func, args=args, daemon=True).start()

def generate_license_gui_threaded():
    try:
        max_ips = int(max_ips_entry.get())
        if max_ips < 1:
            messagebox.showerror("Error", "El límite de IPs únicas debe ser un número positivo.")
            return

        result = generate_license_api(max_ips)
        if result and result.get('success'):
            messagebox.showinfo("Éxito", f"Licencia generada: {result.get('license')}")
            # Refresh the licenses list in the main thread after API call
            root.after(0, view_licenses_gui)
        elif result:
            messagebox.showerror("Error al Generar", result.get('message', 'Error desconocido al generar la licencia.'))
    except ValueError:
        messagebox.showerror("Error", "Por favor, introduce un número válido para las IPs únicas.")

def invalidate_license_gui_threaded():
    license_key = invalidate_license_entry.get()
    if not license_key:
        messagebox.showerror("Error", "Por favor, introduce una clave de licencia para invalidar.")
        return

    result = invalidate_license_api(license_key)
    if result and result.get('success'):
        messagebox.showinfo("Éxito", result.get('message', 'Licencia invalidada con éxito.'))
        # Refresh the licenses list in the main thread after API call
        root.after(0, view_licenses_gui)
    elif result:
        messagebox.showerror("Error al Invalidar", result.get('message', 'Error desconocido al invalidar la licencia.'))

def view_licenses_gui_threaded():
    licenses_data = get_licenses_api()
    licenses_text.delete("1.0", ctk.END) # Clear previous content
    if licenses_data:
        if not licenses_data:
            licenses_text.insert(ctk.END, "No hay licencias registradas.\n")
            return

        licenses_text.insert(ctk.END, "--- Listado de Licencias ---\n\n")
        for lic in licenses_data:
            licenses_text.insert(ctk.END, f"Clave: {lic.get('licenseKey')}\n", "key_highlight") # Use a new tag for color
            licenses_text.insert(ctk.END, f"  Máx IPs: {lic.get('maxUniqueIps')}\n")
            activated_ips = ', '.join(lic.get('activatedIps', [])) or 'Ninguna'
            licenses_text.insert(ctk.END, f"  IPs Activas: {activated_ips}\n")
            
            is_valid_text = 'Sí' if lic.get('isValid') else 'No'
            valid_tag = "success" if lic.get('isValid') else "error"
            licenses_text.insert(ctk.END, f"  Válida: {is_valid_text}\n", valid_tag)
            
            licenses_text.insert(ctk.END, f"  Último Uso: {lic.get('lastUsed')}\n")
            licenses_text.insert(ctk.END, f"  Creada: {lic.get('createdAt')}\n")
            licenses_text.insert(ctk.END, "----------------------------\n\n")
    else:
        licenses_text.insert(ctk.END, "Error al cargar licencias o no hay datos.\n")

def view_users_gui_threaded():
    users_data = get_users_api()
    users_text.delete("1.0", ctk.END) # Clear previous content
    if users_data:
        if not users_data:
            users_text.insert(ctk.END, "No hay usuarios registrados.\n")
            return

        users_text.insert(ctk.END, "--- Listado de Usuarios ---\n\n")
        for user in users_data:
            users_text.insert(ctk.END, f"Email: {user.get('userEmail')}\n", "key_highlight") 
            users_text.insert(ctk.END, f"  Nombre: {user.get('userName')}\n")
            users_text.insert(ctk.END, f"  Licencia Asociada: {user.get('licenseKey')}\n")
            users_text.insert(ctk.END, f"  Primer Acceso: {user.get('firstAccess')}\n")
            users_text.insert(ctk.END, f"  Último Acceso: {user.get('lastAccess')}\n")
            users_text.insert(ctk.END, "---------------------------\n\n")
    else:
        users_text.insert(ctk.END, "Error al cargar usuarios o no hay datos.\n")

def set_maintenance_mode_gui_threaded():
    current_state = maintenance_mode_var.get()
    new_state = not current_state # Toggle the state

    result = set_maintenance_mode_api(new_state)
    if result and result.get('success'):
        maintenance_mode_var.set(new_state)
        messagebox.showinfo("Éxito", result.get('message'))
        root.after(0, update_maintenance_status_label) # Update UI in main thread
        root.after(0, update_maintenance_toggle_button) # Update button in main thread
    elif result:
        messagebox.showerror("Error", result.get('message'))

def get_maintenance_status_gui_threaded():
    status = get_maintenance_status_api()
    if status is not None:
        maintenance_mode_var.set(status.get('maintenanceMode', False))
        root.after(0, update_maintenance_status_label) # Update UI in main thread
        root.after(0, update_maintenance_toggle_button) # Update button in main thread
    # Error message already handled by make_request

# --- UI Update Callbacks (must be called from main thread) ---
def view_licenses_gui():
    run_in_thread(view_licenses_gui_threaded)

def view_users_gui():
    run_in_thread(view_users_gui_threaded)

def generate_license_trigger():
    run_in_thread(generate_license_gui_threaded)

def invalidate_license_trigger():
    run_in_thread(invalidate_license_gui_threaded)

def toggle_maintenance_trigger():
    run_in_thread(set_maintenance_mode_gui_threaded)

def get_maintenance_status_trigger():
    run_in_thread(get_maintenance_status_gui_threaded)

def update_maintenance_status_label():
    status_text = "ACTIVADO ✅" if maintenance_mode_var.get() else "DESACTIVADO ❌"
    maintenance_status_label.configure(text=f"Modo Mantenimiento: {status_text}",
                                       text_color="red" if maintenance_mode_var.get() else "green")

def update_maintenance_toggle_button():
    if maintenance_mode_var.get():
        maintenance_toggle_button.configure(text="Desactivar Modo Mantenimiento", fg_color="red", hover_color="#cc0000")
    else:
        maintenance_toggle_button.configure(text="Activar Modo Mantenimiento", fg_color="green", hover_color="#008000")


# --- Main Application Window Setup ---
root = ctk.CTk()
root.title("Ebook License Manager")
root.geometry("900x750")
root.resizable(True, True)

# Create Tabs/Notebook
tabview = ctk.CTkTabview(root)
tabview.pack(expand=True, fill="both", padx=20, pady=20)

# Add tabs
license_tab = tabview.add("Gestión de Licencias")
view_data_tab = tabview.add("Ver Datos")
maintenance_tab = tabview.add("Modo Mantenimiento")

# --- License Management Tab ---
# Generate License Section
generate_frame = ctk.CTkFrame(license_tab, corner_radius=10)
generate_frame.pack(pady=10, padx=10, fill="x", expand=True)

ctk.CTkLabel(generate_frame, text="Generar Nueva Licencia", font=ctk.CTkFont(size=16, weight="bold")).pack(pady=10)
ctk.CTkLabel(generate_frame, text="Máximo de IPs Únicas:").pack(pady=5)
max_ips_entry = ctk.CTkEntry(generate_frame, placeholder_text="Ej: 1")
max_ips_entry.insert(0, "1") # Default value
max_ips_entry.pack(pady=5, padx=20, fill="x")
ctk.CTkButton(generate_frame, text="Generar Licencia", command=generate_license_trigger,
              fg_color="#4A729E", hover_color="#375F8A").pack(pady=10) # Using primary colors

# Separator
ctk.CTkFrame(license_tab, height=2, fg_color="gray", corner_radius=0).pack(fill="x", pady=15, padx=10)

# Invalidate License Section
invalidate_frame = ctk.CTkFrame(license_tab, corner_radius=10)
invalidate_frame.pack(pady=10, padx=10, fill="x", expand=True)

ctk.CTkLabel(invalidate_frame, text="Invalidar Licencia Existente", font=ctk.CTkFont(size=16, weight="bold")).pack(pady=10)
ctk.CTkLabel(invalidate_frame, text="Clave de Licencia a Invalidar:").pack(pady=5)
invalidate_license_entry = ctk.CTkEntry(invalidate_frame, placeholder_text="Introduce la clave de licencia")
invalidate_license_entry.pack(pady=5, padx=20, fill="x")
ctk.CTkButton(invalidate_frame, text="Invalidar Licencia", command=invalidate_license_trigger,
              fg_color="#7091B8", hover_color="#5A7D9D").pack(pady=10) # Using secondary color


# --- View Data Tab ---
# Licenses View
licenses_view_frame = ctk.CTkFrame(view_data_tab, corner_radius=10)
licenses_view_frame.pack(pady=10, padx=10, fill="both", expand=True)

ctk.CTkLabel(licenses_view_frame, text="Licencias Registradas", font=ctk.CTkFont(size=16, weight="bold")).pack(pady=10)
licenses_text = ctk.CTkTextbox(licenses_view_frame, wrap="word", activate_scrollbars=True, height=250)
licenses_text.pack(pady=10, padx=10, fill="both", expand=True)

# Corrected tag_config: Use 'foreground' instead of 'text_color' for CTkTextbox tags
licenses_text.tag_config("key_highlight", foreground="#4A729E") # Changed to foreground
licenses_text.tag_config("success", foreground="green") # Changed to foreground
licenses_text.tag_config("error", foreground="red") # Changed to foreground

ctk.CTkButton(licenses_view_frame, text="Cargar Licencias", command=view_licenses_gui,
              fg_color="#4A729E", hover_color="#375F8A").pack(pady=10)

ctk.CTkFrame(view_data_tab, height=2, fg_color="gray", corner_radius=0).pack(fill="x", pady=15, padx=10)

# Users View
users_view_frame = ctk.CTkFrame(view_data_tab, corner_radius=10)
users_view_frame.pack(pady=10, padx=10, fill="both", expand=True)

ctk.CTkLabel(users_view_frame, text="Datos de Usuarios Registrados", font=ctk.CTkFont(size=16, weight="bold")).pack(pady=10)
users_text = ctk.CTkTextbox(users_view_frame, wrap="word", activate_scrollbars=True, height=250)
users_text.pack(pady=10, padx=10, fill="both", expand=True)
# Corrected tag_config: Use 'foreground' instead of 'text_color'
users_text.tag_config("key_highlight", foreground="#4A729E") # Changed to foreground

ctk.CTkButton(users_view_frame, text="Cargar Usuarios", command=view_users_gui,
              fg_color="#7091B8", hover_color="#5A7D9D").pack(pady=10)


# --- Maintenance Mode Tab ---
maintenance_mode_var = ctk.BooleanVar()
maintenance_mode_var.set(False) # Initial state, will be updated from server

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
root.after(100, get_maintenance_status_trigger) # Run after 100ms to allow GUI to set up

# Start the application
root.mainloop()