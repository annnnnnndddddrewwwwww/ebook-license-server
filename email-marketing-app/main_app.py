import customtkinter as ctk
from app_logic import EmailMarketingApp
import os
from PIL import Image, ImageTk # Necesario para cargar imágenes

# Configuración de CustomTkinter
ctk.set_appearance_mode("System")  # Modes: "System" (default), "Dark", "Light"
ctk.set_default_color_theme("blue")  # Themes: "blue" (default), "green", "dark-blue"

class App(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title("App de Marketing por Correo")
        self.geometry("900x700")
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=1)

        self.app_logic = EmailMarketingApp()
        self.all_emails = []
        self.selected_emails = set()

        # --- Frames principales ---
        self.main_frame = ctk.CTkFrame(self, corner_radius=10)
        self.main_frame.grid(row=0, column=0, padx=20, pady=20, sticky="nsew")
        self.main_frame.grid_columnconfigure(0, weight=1)
        self.main_frame.grid_rowconfigure((1, 2), weight=1) # Filas para lista de emails y cuerpo de correo

        # --- Header ---
        self.header_frame = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        self.header_frame.grid(row=0, column=0, pady=10, sticky="ew")
        self.header_frame.grid_columnconfigure(0, weight=1)

        # Intenta cargar el logo
        try:
            # Reemplaza 'images/your_logo.png' con la ruta a tu logo
            # Si no tienes un logo, el try-except manejará el error y no lo mostrará
            script_dir = os.path.dirname(__file__) # Directorio del script actual
            logo_path = os.path.join(script_dir, 'images', 'Eva_Vidal_horizontal.png') # Ajusta el nombre del archivo
            if os.path.exists(logo_path):
                logo_image = Image.open(logo_path)
                logo_image = logo_image.resize((180, 60), Image.LANCZOS) # Ajusta el tamaño
                self.logo_tk = ImageTk.PhotoImage(logo_image)
                self.logo_label = ctk.CTkLabel(self.header_frame, image=self.logo_tk, text="")
                self.logo_label.grid(row=0, column=0, pady=(0, 10))
            else:
                print(f"Advertencia: No se encontró el archivo de logo en {logo_path}")
                self.logo_label = ctk.CTkLabel(self.header_frame, text="Tu Logo Aquí", font=ctk.CTkFont(size=20, weight="bold"), text_color="#4A729E")
                self.logo_label.grid(row=0, column=0, pady=(0, 10))
        except Exception as e:
            print(f"Error al cargar el logo: {e}")
            self.logo_label = ctk.CTkLabel(self.header_frame, text="Tu Logo Aquí", font=ctk.CTkFont(size=20, weight="bold"), text_color="#4A729E")
            self.logo_label.grid(row=0, column=0, pady=(0, 10))


        ctk.CTkLabel(self.header_frame, text="Gestor de Correos de Usuarios", font=ctk.CTkFont(size=24, weight="bold"), text_color="#4A729E").grid(row=1, column=0, pady=(0, 5))
        ctk.CTkLabel(self.header_frame, text="Envía correos personalizados a tus usuarios registrados.", font=ctk.CTkFont(size=14, weight="normal")).grid(row=2, column=0, pady=(0, 20))

        # --- Sección de Destinatarios ---
        self.recipients_frame = ctk.CTkFrame(self.main_frame, corner_radius=10)
        self.recipients_frame.grid(row=1, column=0, padx=20, pady=10, sticky="nsew")
        self.recipients_frame.grid_columnconfigure(0, weight=1)
        self.recipients_frame.grid_rowconfigure(1, weight=1)

        ctk.CTkLabel(self.recipients_frame, text="1. Selecciona Destinatarios", font=ctk.CTkFont(size=18, weight="bold"), fg_color="transparent").grid(row=0, column=0, padx=10, pady=(10, 5), sticky="w")

        self.recipient_controls_frame = ctk.CTkFrame(self.recipients_frame, fg_color="transparent")
        self.recipient_controls_frame.grid(row=1, column=0, padx=10, pady=5, sticky="ew")
        self.recipient_controls_frame.grid_columnconfigure((0, 1), weight=0)
        self.recipient_controls_frame.grid_columnconfigure(2, weight=1) # Columna para el contador

        ctk.CTkButton(self.recipient_controls_frame, text="Seleccionar Todos", command=self.select_all_emails).grid(row=0, column=0, padx=(0, 10), pady=5)
        ctk.CTkButton(self.recipient_controls_frame, text="Deseleccionar Todos", command=self.deselect_all_emails).grid(row=0, column=1, padx=(0, 10), pady=5)
        self.selected_count_label = ctk.CTkLabel(self.recipient_controls_frame, text="0 usuarios seleccionados", font=ctk.CTkFont(weight="bold"))
        self.selected_count_label.grid(row=0, column=2, sticky="e", padx=(0,5))

        self.email_list_scroll_frame = ctk.CTkScrollableFrame(self.recipients_frame, label_text="Correos de Usuarios", corner_radius=8)
        self.email_list_scroll_frame.grid(row=2, column=0, padx=10, pady=10, sticky="nsew")
        self.email_list_scroll_frame.grid_columnconfigure(0, weight=1)

        self.no_users_label = ctk.CTkLabel(self.email_list_scroll_frame, text="Cargando usuarios...", font=ctk.CTkFont(size=14, slant="italic"))
        self.no_users_label.grid(row=0, column=0, padx=20, pady=20)


        # --- Sección de Redacción de Correo ---
        self.compose_frame = ctk.CTkFrame(self.main_frame, corner_radius=10)
        self.compose_frame.grid(row=2, column=0, padx=20, pady=10, sticky="nsew")
        self.compose_frame.grid_columnconfigure(0, weight=1)
        self.compose_frame.grid_rowconfigure(2, weight=1) # Make the textbox expand

        ctk.CTkLabel(self.compose_frame, text="2. Redacta tu Correo", font=ctk.CTkFont(size=18, weight="bold"), fg_color="transparent").grid(row=0, column=0, padx=10, pady=(10, 5), sticky="w")

        ctk.CTkLabel(self.compose_frame, text="Asunto del Correo:").grid(row=1, column=0, padx=10, pady=(10, 5), sticky="w")
        self.subject_entry = ctk.CTkEntry(self.compose_frame, placeholder_text="Asunto del correo", width=400)
        self.subject_entry.grid(row=1, column=0, padx=10, pady=(0, 10), sticky="ew")

        ctk.CTkLabel(self.compose_frame, text="Cuerpo del Correo (HTML permitido):").grid(row=2, column=0, padx=10, pady=(10, 5), sticky="w")
        self.body_textbox = ctk.CTkTextbox(self.compose_frame, height=200, width=500)
        self.body_textbox.grid(row=3, column=0, padx=10, pady=(0, 10), sticky="nsew")
        self.body_textbox.insert("0.0", """
<h2 style="color:#4A729E;">¡Bienvenido a la comunidad de Eva Vidal!</h2>
<p>Gracias por registrarte y unirte a nuestra familia. Estamos emocionados de tenerte con nosotros.</p>
<p>Explora nuestro contenido exclusivo y no dudes en contactarnos si tienes alguna pregunta.</p>
<p>Saludos cordiales,<br>El equipo de Eva Vidal</p>
<img src="https://placehold.co/200x80/4A729E/ffffff?text=Tu+Logo" alt="Logo" style="max-width:200px; margin-top:20px;">
        """)


        self.send_button = ctk.CTkButton(self.compose_frame, text="Enviar Correos", command=self.send_emails)
        self.send_button.grid(row=4, column=0, padx=10, pady=20, sticky="ew")

        self.message_label = ctk.CTkLabel(self.compose_frame, text="", text_color="red")
        self.message_label.grid(row=5, column=0, padx=10, pady=5, sticky="ew")


        self.after(100, self.load_emails_async) # Carga los emails asincrónicamente al inicio

    def display_message(self, message, message_type="info"):
        """Muestra un mensaje al usuario."""
        if message_type == "success":
            self.message_label.configure(text_color="green")
        elif message_type == "error":
            self.message_label.configure(text_color="red")
        else:
            self.message_label.configure(text_color="orange")
        self.message_label.configure(text=message)
        self.update_idletasks() # Asegura que el mensaje se actualice visiblemente
        self.after(5000, lambda: self.message_label.configure(text="")) # Borra el mensaje después de 5 segundos

    def update_selected_count(self):
        self.selected_count_label.configure(text=f"{len(self.selected_emails)} usuarios seleccionados")

    def load_emails_async(self):
        """Carga los emails en un hilo separado o usando after para evitar congelar la UI."""
        self.no_users_label.configure(text="Cargando usuarios...")
        self.update_idletasks() # Actualiza el texto inmediatamente
        
        # Simula un hilo o operación larga, luego llama a la función real
        def _load():
            try:
                emails = self.app_logic.get_registered_emails()
                if emails:
                    self.all_emails = sorted(emails) # Ordena alfabéticamente
                    self.display_emails()
                else:
                    self.no_users_label.configure(text="No se encontraron usuarios registrados o hubo un error.")
            except Exception as e:
                self.no_users_label.configure(text=f"Error al cargar usuarios: {e}")
            finally:
                self.update_selected_count()

        # Ejecutar la carga en el "hilo principal" de Tkinter para seguridad
        # Para operaciones realmente largas, se usaría threading, pero CustomTkinter
        # requiere actualizaciones de UI en el hilo principal.
        # Aquí, get_registered_emails ya maneja la espera de red.
        _load()


    def display_emails(self):
        """Muestra la lista de emails en el scrollable frame."""
        # Limpia el contenido anterior
        for widget in self.email_list_scroll_frame.winfo_children():
            widget.destroy()

        if not self.all_emails:
            self.no_users_label.configure(text="No se encontraron usuarios registrados.")
            self.no_users_label.grid(row=0, column=0, padx=20, pady=20)
            return
        
        self.no_users_label.grid_forget() # Oculta el mensaje de "no usuarios"

        for i, email in enumerate(self.all_emails):
            checkbox = ctk.CTkCheckBox(self.email_list_scroll_frame, text=email, command=lambda e=email: self.toggle_email_selection(e))
            checkbox.grid(row=i // 2, column=i % 2, padx=5, pady=2, sticky="w")
            if email in self.selected_emails:
                checkbox.select() # Marca si ya estaba seleccionado
            
        self.update_selected_count()

    def toggle_email_selection(self, email):
        if email in self.selected_emails:
            self.selected_emails.remove(email)
        else:
            self.selected_emails.add(email)
        self.update_selected_count()

    def select_all_emails(self):
        self.selected_emails.clear()
        for email in self.all_emails:
            self.selected_emails.add(email)
        self.display_emails() # Redibuja para que las checkboxes se marquen
        self.update_selected_count()

    def deselect_all_emails(self):
        self.selected_emails.clear()
        self.display_emails() # Redibuja para que las checkboxes se desmarquen
        self.update_selected_count()

    def send_emails(self):
        recipients = list(self.selected_emails)
        subject = self.subject_entry.get().strip()
        html_body = self.body_textbox.get("1.0", "end-1c").strip()

        if not recipients:
            self.display_message("Por favor, selecciona al menos un destinatario.", "error")
            return
        if not subject:
            self.display_message("El asunto del correo no puede estar vacío.", "error")
            return
        if not html_body:
            self.display_message("El cuerpo del correo no puede estar vacío.", "error")
            return

        self.send_button.configure(state="disabled", text="Enviando...")
        self.display_message("Enviando correos...", "info")

        # Usar self.after para simular una operación asíncrona y no bloquear la UI
        # Para operaciones realmente largas se usaría un Threading, pero es más complejo con CustomTkinter
        # debido a que las actualizaciones de UI deben ocurrir en el hilo principal.
        # Aquí, EmailMarketingApp.send_email ya espera la respuesta de la API.
        
        def _send():
            success = self.app_logic.send_email(recipients, subject, html_body)
            if success:
                self.display_message(f"¡Correos enviados a {len(recipients)} destinatarios!", "success")
                # self.subject_entry.delete(0, ctk.END)
                # self.body_textbox.delete("1.0", ctk.END)
                # self.deselect_all_emails() # Opcional: desmarcar después de enviar
            else:
                self.display_message("Fallo al enviar correos. Revisa la consola para más detalles.", "error")
            self.send_button.configure(state="normal", text="Enviar Correos")

        # Ejecutar la lógica de envío en el hilo principal de Tkinter
        _send()


if __name__ == "__main__":
    app = App()
    app.mainloop()
