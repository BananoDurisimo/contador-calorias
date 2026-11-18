# Contador de Calorías

**App en línea:** https://bananodurisimo.github.io/contador-calorias/

Aplicación web para registrar las calorías y macronutrientes que consumes cada día usando **tus propios productos** con sus valores nutricionales.

## Funciones

- **Productos personalizados**: nombre, marca y valores por 100 g, 100 ml o por unidad/porción (kcal, proteína, carbohidratos, grasa, fibra y azúcar).
- **Diario** por comidas (desayuno, almuerzo, cena, snacks) con cálculo automático según la cantidad consumida.
- **Metas diarias** de calorías, macros, fibra, agua, pasos y sueño, con proteína por comida.
- **Historial** de 7 o 30 días con gráfico y tabla.
- **Hábitos del día**: peso en ayunas, pasos, horas de sueño, agua y cintura (semanal).
- **Progreso**: peso diario con promedio de 7 días, resumen semanal y recomendación automática de ajuste (±150 kcal).
- **Mi plan**: calorías y macros calculados desde tu perfil (Mifflin-St Jeor, RFM), con las pautas del plan.
- **Tips al entrar**: recordatorio de las reglas de seguimiento cada vez que abres la app.
- **Copia de seguridad** en JSON (exportar / importar).

## Base de datos

| Modo | Tecnología | Dónde viven los datos |
|---|---|---|
| Por defecto | **IndexedDB** (base de datos integrada en el navegador) | Solo en ese navegador y dispositivo. No requiere configuración. |
| Opcional (recomendado) | **Supabase** (PostgreSQL en la nube, plan gratuito) | En la nube, con inicio de sesión. Accesible desde cualquier dispositivo. |

### Activar Supabase

1. Crea una cuenta y un proyecto en [supabase.com](https://supabase.com).
2. En el proyecto: **SQL Editor → New query**, pega el contenido de [`supabase/schema.sql`](supabase/schema.sql) y pulsa **Run**.
3. En **Project Settings → API** copia la *Project URL* y la clave *anon / publishable*.
4. En la app: **Ajustes → Base de datos → Sincronizar en la nube con Supabase**, pega la URL y la clave y guarda.
5. Crea tu cuenta (correo + contraseña) e inicia sesión. Si tenías datos locales, usa **Copiar datos locales a la nube**.

> La clave *anon* es pública por diseño. La seguridad la dan el inicio de sesión y las políticas **Row Level Security** del esquema: cada usuario solo puede leer y modificar sus propios datos.
>
> Por defecto Supabase pide confirmar el correo al registrarse. En **Authentication → URL Configuration** pon como *Site URL* la dirección de GitHub Pages para que el enlace de confirmación vuelva a la app.

## Desarrollo local

Es un sitio estático (HTML, CSS y JavaScript sin dependencias de compilación):

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

## Despliegue

Publicado con **GitHub Pages** desde la rama `main` (carpeta raíz): https://bananodurisimo.github.io/contador-calorias/
