# Instrucciones para agentes — Consentimiento (Skill Hands)

Esta es una aplicación HTML de **consentimiento estético** alojada en un repositorio público. Su código y los cambios enviados aquí son visibles públicamente.

## Criterios transversales de calidad, ahorro y autonomía
- Priorizar calidad profesional, seguridad, accesibilidad, compatibilidad iPhone/iPad y pruebas verificables. No prometer perfección ni declarar éxito sin evidencia.
- Presupuesto objetivo: **USD 0**. No contratar planes, vincular medios de pago, elevar cuotas ni activar recursos premium.
- Reducir uso de ChatGPT Work/Codex: inspeccionar primero código, documentación y automatizaciones existentes; usar pruebas deterministas, herramientas gratuitas y CI antes de recurrir a otro análisis de IA.
- Evitar duplicar dependencias, agentes, escáneres o flujos de GitHub Actions. Los minutos gratuitos de repositorios privados son limitados; reservar análisis pesados para ejecución manual y justificar cambios de periodicidad.
- Cuando una herramienta, plugin o servicio pueda ayudarnos, sugerirlo proactivamente con **beneficio concreto, alternativa existente, coste/cuota, permisos, privacidad y riesgo**; pedir aprobación antes de vincular cuentas o introducir servicios externos.
- Mantener las configuraciones versionadas en GitHub y operables desde iPhone/iPad o navegador. No instalar nada en el Mac compartido salvo instrucción expresa.
- Usar datos sintéticos en pruebas. Nunca subir a GitHub ni exponer en logs credenciales, tokens, RUT, nombres de pacientes, historias o documentos clínicos identificables.
- Trabajar en ramas y pull requests acotados; no fusionar en la rama productiva ni activar despliegues, migraciones, cambios de bases de datos o secretos sin autorización **específica para esa operación**.
- Conservar el trabajo de otros agentes y toda regla clínica o funcional preexistente. Reportar qué se verificó y qué sigue pendiente.

## Reglas propias de Consentimiento
- Nunca agregar identificadores, firmas, RUT, fotografías, consentimientos completados o expedientes reales al repositorio, pruebas o logs.
- Mantener la funcionalidad de formularios, firma y generación PDF sin cambiar textos médico-legales sin revisión profesional específica.
- Evitar dependencias o servicios adicionales para verificar HTML/JavaScript: usar el validador Node sin paquetes del repositorio y el workflow ligero de pull request.
- La compilación sintáctica del JavaScript no sustituye una revisión de seguridad, privacidad, validez jurídica ni pruebas de consentimiento firmado.
- Gitleaks manual revisa posibles secretos del historial; ejecutar voluntariamente, revisar cualquier hallazgo sin publicar el valor de la credencial.
