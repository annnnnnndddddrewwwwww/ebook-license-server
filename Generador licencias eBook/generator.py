import customtkinter as ctk
import requests
import json
import os
from datetime import datetime
from PIL import Image # Solo necesitamos Image de PIL para abrir la imagen

# --- Configuración ---
# ¡IMPORTANTE! Reemplaza esto con la URL REAL de tu API en Render
RENDER_SERVER_URL = "https://mi-ebook-licencias-api.onrender.com" # Cambia esto si tu URL es diferente

# Rutas de los endpoints en tu servidor Node.js
GENERATE_URL = f"{RENDER_SERVER_URL}/generate-license"
INVALIDATE_URL = f"{RENDER_SERVER_URL}/invalidate-license" # Este endpoint no existe aún en tu server.js
GET_ALL_LICENSES_URL = f"{RENDER_SERVER_URL}/licenses" # Este endpoint no existe aún en tu server.js
GET_ALL_USERS_URL = f"{RENDER_SERVER_URL}/users" # Este endpoint no existe aún en tu server.js
SET_MAINTENANCE_URL = f"{RENDER_SERVER_URL}/set-maintenance-mode"
GET_MAINTENANCE_STATUS_URL = f"{RENDER_SERVER_URL}/get-maintenance-status"

LOCAL_LICENSES_FILE = "generated_licenses_log.json"
LOGO_PATH = "Eva Vidal _ reducido.png" # Asegúrate de que está en el mismo directorio o especifica la ruta completa

# Cargar ADMIN_API_KEY desde las variables de entorno
# En entorno de producción, esto es crucial. En local, puedes definirla en tu .env o directamente aquí para pruebas.
ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", "f4k3ap1K3Y2025!@#$") # ¡CAMBIA ESTO POR UNA CLAVE SEGURA!

# --- Funciones de Utilidad para el Historial Local ---

def load_local_licenses():
    """Carga el historial de licencias generadas desde un archivo local."""
    if os.path.exists(LOCAL_LICENSES_FILE):
        with open(LOCAL_LICENSES_FILE, 'r', encoding='utf-8') as f:
            try:
                data = json.load(f)
                # Asegura que 'timestamp' existe para entradas antiguas si es necesario, aunque el .get() ya lo maneja
                for item in data:
                    if 'timestamp' not in item:
                        item['timestamp'] = 'N/A (Antigua)' # Asigna un valor por defecto si no existe
                return data
            except json.JSONDecodeError:
                return [] # Retorna lista vacía si el JSON está corrupto
    return []

def save_local_licenses(licenses_list):
    """Guarda el historial de licencias generadas en un archivo local."""
    with open(LOCAL_LICENSES_FILE, 'w', encoding='utf-8') as f:
        json.dump(licenses_list, f, indent=4, ensure_ascii=False)

# --- Clase de la Aplicación Principal ---

class App(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title("Panel de Control de Licencias")
        self.geometry("800x700") # Aumenta el tamaño para la nueva sección
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        # Cargar el logo usando CTkImage para HighDPI
        self.logo = None
        try:
            # Abre la imagen y redimensiona (ajusta el tamaño según necesites)
            original_image = Image.open(LOGO_PATH)
            resized_image = original_image.resize((150, 150), Image.LANCZOS)
            self.logo = ctk.CTkImage(light_image=resized_image, dark_image=resized_image, size=(150,150))
        except FileNotFoundError:
            print(f"Advertencia: No se encontró el logo en '{LOGO_PATH}'.")
            self.logo = None
        except Exception as e:
            print(f"Error al cargar el logo: {e}")
            self.logo = None

        # --- Creación del Marco Principal ---
        self.main_frame = ctk.CTkFrame(self)
        self.main_frame.grid(row=0, column=0, padx=20, pady=20, sticky="nsew")
        self.main_frame.grid_columnconfigure(0, weight=1)
        # La primera fila (donde estará el logo) no debe expandirse, la segunda (tabview) sí.
        self.main_frame.grid_rowconfigure(0, weight=0) # Fila del logo
        self.main_frame.grid_rowconfigure(1, weight=1) # Fila de las pestañas

        # --- Widgets del Logo (en el marco principal, encima de las pestañas) ---
        if self.logo:
            self.logo_label = ctk.CTkLabel(self.main_frame, image=self.logo, text="")
            self.logo_label.grid(row=0, column=0, padx=10, pady=10, sticky="n") # Columna 0 de main_frame
            # No se necesita columnspan si solo hay 1 columna principal para el contenido
        
        # --- Pestañas ---
        self.tabview = ctk.CTkTabview(self.main_frame)
        # Ajusta la fila a 1 para que esté debajo del logo
        self.tabview.grid(row=1, column=0, padx=20, pady=20, sticky="nsew") 

        # Pestaña de Mantenimiento
        self.tabview.add("Mantenimiento")
        self.tabview.tab("Mantenimiento").grid_columnconfigure(0, weight=1)

        # Pestaña de Generador de Licencias (NUEVA)
        self.tabview.add("Generador de Licencias")
        self.tabview.tab("Generador de Licencias").grid_columnconfigure(0, weight=1)

        # --- Configuración de la Pestaña de Mantenimiento ---
        self.maintenance_checkbox = ctk.CTkCheckBox(self.tabview.tab("Mantenimiento"), text="Activar Modo de Mantenimiento", command=self.toggle_maintenance_mode)
        self.maintenance_checkbox.grid(row=0, column=0, padx=20, pady=(20, 10), sticky="ew")

        self.maintenance_status_label = ctk.CTkLabel(self.tabview.tab("Mantenimiento"), text="Cargando estado del modo de mantenimiento...", text_color="gray")
        self.maintenance_status_label.grid(row=1, column=0, padx=20, pady=10, sticky="ew")

        self.refresh_maintenance_btn = ctk.CTkButton(self.tabview.tab("Mantenimiento"), text="Actualizar Estado", command=self.get_maintenance_status)
        self.refresh_maintenance_btn.grid(row=2, column=0, padx=20, pady=10, sticky="ew")

        # --- Configuración de la Pestaña del Generador de Licencias ---
        self.generator_frame = ctk.CTkFrame(self.tabview.tab("Generador de Licencias"))
        self.generator_frame.grid(row=0, column=0, padx=20, pady=20, sticky="nsew")
        self.generator_frame.grid_columnconfigure(0, weight=1)

        self.max_ips_label = ctk.CTkLabel(self.generator_frame, text="Máximo de IPs Únicas:")
        self.max_ips_label.grid(row=0, column=0, padx=10, pady=5, sticky="w")
        self.max_ips_entry = ctk.CTkEntry(self.generator_frame, placeholder_text="Ej: 1 (por defecto), 3, 5...")
        self.max_ips_entry.grid(row=1, column=0, padx=10, pady=5, sticky="ew")
        self.max_ips_entry.insert(0, "1") # Valor por defecto

        self.generate_btn = ctk.CTkButton(self.generator_frame, text="Generar Nueva Licencia", command=self.generate_license)
        self.generate_btn.grid(row=2, column=0, padx=10, pady=20, sticky="ew")

        self.generated_license_label = ctk.CTkLabel(self.generator_frame, text="", wraplength=400)
        self.generated_license_label.grid(row=3, column=0, padx=10, pady=5, sticky="ew")

        self.generator_status_label = ctk.CTkLabel(self.generator_frame, text="", text_color="gray", wraplength=400)
        self.generator_status_label.grid(row=4, column=0, padx=10, pady=5, sticky="ew")

        # Marco para el historial de licencias generadas
        self.history_frame = ctk.CTkFrame(self.tabview.tab("Generador de Licencias"))
        self.history_frame.grid(row=1, column=0, padx=20, pady=(10, 20), sticky="nsew")
        self.history_frame.grid_columnconfigure(0, weight=1)
        self.history_frame.grid_rowconfigure(0, weight=1)

        self.history_label = ctk.CTkLabel(self.history_frame, text="Historial de Licencias Generadas (Local):")
        self.history_label.grid(row=0, column=0, padx=10, pady=5, sticky="w")

        self.history_textbox = ctk.CTkTextbox(self.history_frame, width=500, height=150, wrap="word")
        self.history_textbox.grid(row=1, column=0, padx=10, pady=5, sticky="nsew")
        self.history_textbox.configure(state="disabled") # Solo lectura

        # Cargar historial al iniciar
        self.licenses_history = load_local_licenses()
        self.update_history_textbox()

        # Iniciar la actualización periódica del estado de mantenimiento
        self.update_maintenance_status_periodically()

    def update_history_textbox(self):
        self.history_textbox.configure(state="normal")
        self.history_textbox.delete("1.0", "end")
        if self.licenses_history:
            for item in reversed(self.licenses_history): # Mostrar las más recientes primero
                # Usa .get() para evitar KeyError si 'timestamp' no existe en entradas antiguas
                timestamp_str = item.get('timestamp', 'Fecha Desconocida')
                self.history_textbox.insert("end", f"[{timestamp_str}] {item['licenseKey']} (IPs: {item['maxUniqueIps']})\n")
        else:
            self.history_textbox.insert("end", "No hay licencias generadas localmente aún.\n")
        self.history_textbox.configure(state="disabled")

    # Eliminado 'async' de la definición de la función
    def _get_maintenance_status(self):
        """Función interna para obtener el estado de mantenimiento."""
        self.maintenance_checkbox.configure(state="disabled") # Deshabilitar mientras carga
        self.refresh_maintenance_btn.configure(state="disabled")
        try:
            response = requests.get(GET_MAINTENANCE_STATUS_URL, timeout=10)
            response.raise_for_status()  # Lanza una excepción para códigos de estado HTTP erróneos
            data = response.json()
            is_active = data.get("maintenanceMode", False)
            self.maintenance_checkbox.select() if is_active else self.maintenance_checkbox.deselect()
            if is_active:
                self.maintenance_status_label.configure(text=f"✅ Estado actual: ACTIVO", text_color="green")
            else:
                self.maintenance_status_label.configure(text=f"🟢 Estado actual: DESACTIVADO", text_color="green")
        except requests.exceptions.Timeout:
            self.maintenance_status_label.configure(text=f"❌ Error de conexión: Tiempo de espera agotado. Asegúrate de que el servidor está en línea.", text_color="red")
        except requests.exceptions.ConnectionError:
            self.maintenance_status_label.configure(text=f"❌ Error de conexión: No se pudo conectar al servidor. Verifica la URL.", text_color="red")
        except requests.exceptions.RequestException as e:
            self.maintenance_status_label.configure(text=f"❌ Error al consultar estado: {e}. Asegúrate de que el endpoint '{GET_MAINTENANCE_STATUS_URL}' funciona.", text_color="red")
        except json.JSONDecodeError:
            self.maintenance_status_label.configure(text=f"❌ Error de datos: Respuesta no válida del servidor. Asegúrate de que el endpoint '{GET_MAINTENANCE_STATUS_URL}' devuelve JSON.", text_color="red")
        finally:
            self.maintenance_checkbox.configure(state="normal")
            self.refresh_maintenance_btn.configure(state="normal")

    def get_maintenance_status(self):
        """Llama al manejador del estado de mantenimiento."""
        # Llamada directa a la función ahora que no es una coroutine
        self.after(10, self._get_maintenance_status)


    # Eliminado 'async' de la definición de la función
    def _toggle_maintenance_mode(self):
        """Función interna para cambiar el modo de mantenimiento."""
        self.maintenance_checkbox.configure(state="disabled") # Deshabilitar mientras carga
        self.refresh_maintenance_btn.configure(state="disabled")
        try:
            new_mode = "true" if self.maintenance_checkbox.get() == 1 else "false"
            headers = {'Content-Type': 'application/json', 'X-API-Key': ADMIN_API_KEY}
            response = requests.post(SET_MAINTENANCE_URL, json={'mode': new_mode}, headers=headers, timeout=10)
            response.raise_for_status()
            data = response.json()
            if data.get("success"):
                self.maintenance_status_label.configure(text=f"✅ Modo de mantenimiento actualizado a: {new_mode.upper()}", text_color="green")
            else:
                self.maintenance_status_label.configure(text=f"❌ Fallo al actualizar el modo de mantenimiento: {data.get('message', 'Error desconocido')}", text_color="red")
        except requests.exceptions.Timeout:
            self.maintenance_status_label.configure(text=f"❌ Error de conexión: Tiempo de espera agotado.", text_color="red")
        except requests.exceptions.ConnectionError:
            self.maintenance_status_label.configure(text=f"❌ Error de conexión: No se pudo conectar al servidor. Verifica la URL.", text_color="red")
        except requests.exceptions.RequestException as e:
            self.maintenance_status_label.configure(text=f"❌ Error al cambiar modo: {e}. ¿API Key correcta? ¿Endpoint '{SET_MAINTENANCE_URL}' funciona?", text_color="red")
        except json.JSONDecodeError:
            self.maintenance_status_label.configure(text=f"❌ Error de datos: Respuesta no válida del servidor.", text_color="red")
        finally:
            self.maintenance_checkbox.configure(state="normal")
            self.refresh_maintenance_btn.configure(state="normal")
            self.get_maintenance_status() # Refresca el estado después del intento

    def toggle_maintenance_mode(self):
        """Llama al manejador del modo de mantenimiento."""
        # Llamada directa a la función ahora que no es una coroutine
        self.after(10, self._toggle_maintenance_mode)

    # Eliminado 'async' de la definición de la función
    def _generate_license(self):
        """Función interna para generar una licencia."""
        self.generate_btn.configure(state="disabled", text="Generando...")
        self.generated_license_label.configure(text="")
        self.generator_status_label.configure(text="Enviando solicitud al servidor...", text_color="gray")

        max_ips_str = self.max_ips_entry.get().strip()
        try:
            max_ips = int(max_ips_str)
            if max_ips <= 0:
                raise ValueError("El número máximo de IPs debe ser un entero positivo.")
        except ValueError as e:
            self.generator_status_label.configure(text=f"❌ Error de entrada: {e}", text_color="red")
            self.generate_btn.configure(state="normal", text="Generar Nueva Licencia")
            return

        try:
            headers = {'Content-Type': 'application/json', 'X-API-Key': ADMIN_API_KEY}
            payload = {'maxUniqueIps': max_ips}
            response = requests.post(GENERATE_URL, json=payload, headers=headers, timeout=10)
            response.raise_for_status()

            data = response.json()
            if data.get("success"):
                license_key = data.get("licenseKey")
                self.generated_license_label.configure(text=f"🔑 Licencia generada: {license_key}", text_color="blue")
                self.generator_status_label.configure(text="✅ Licencia guardada correctamente.", text_color="green")

                # Guardar en historial local
                self.licenses_history.append({
                    "licenseKey": license_key,
                    "maxUniqueIps": max_ips,
                    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                })
                save_local_licenses(self.licenses_history)
                self.update_history_textbox()
            else:
                self.generated_license_label.configure(text="")
                self.generator_status_label.configure(text=f"❌ Fallo en el servidor: {data.get('message', 'Error desconocido')}", text_color="red")

        except requests.exceptions.Timeout:
            self.generator_status_label.configure(text=f"❌ Error de conexión: Tiempo de espera agotado al generar licencia. Asegúrate de que el servidor está en línea.", text_color="red")
        except requests.exceptions.ConnectionError:
            self.generator_status_label.configure(text=f"❌ Error de conexión: No se pudo conectar al servidor. Verifica la URL '{GENERATE_URL}'.", text_color="red")
        except requests.exceptions.RequestException as e:
            self.generator_status_label.configure(text=f"❌ Error de API: {e}. ¿La ADMIN_API_KEY es correcta? ¿El endpoint '{GENERATE_URL}' está bien configurado?", text_color="red")
        except json.JSONDecodeError:
            self.generator_status_label.configure(text=f"❌ Error de datos: Respuesta no válida del servidor. Asegúrate de que el endpoint '{GENERATE_URL}' devuelve JSON.", text_color="red")
        except Exception as e:
            self.generator_status_label.configure(text=f"❌ Error inesperado: {e}", text_color="red")
        finally:
            self.generate_btn.configure(state="normal", text="Generar Nueva Licencia")


    def generate_license(self):
        """Llama al manejador de generación de licencias."""
        # Llamada directa a la función ahora que no es una coroutine
        self.after(10, self._generate_license)


    def update_maintenance_status_periodically(self):
        # Llama a get_maintenance_status inmediatamente al inicio
        self.get_maintenance_status()
        # Luego programa llamadas periódicas (ej. cada 60 segundos)
        self.after(60000, self.update_maintenance_status_periodically)


# --- Ejecución de la Aplicación ---
if __name__ == "__main__":
    # Establecer la apariencia por defecto
    ctk.set_appearance_mode("System")  # Modes: "System" (default), "Dark", "Light"
    ctk.set_default_color_theme("blue")  # Themes: "blue" (default), "dark-blue", "green"

    app = App()
    app.mainloop()