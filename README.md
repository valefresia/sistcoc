# Centro Odontológico Colón

Aplicación web para la gestión del centro. La Etapa 1 incorpora inicio de sesión con Firebase Authentication, autorización por claims y rutas protegidas. La Etapa 2 agrega gestión de pacientes, escritura transaccional validada por reglas Firestore, índice de unicidad de DNI y auditoría. La Etapa 3 incorpora agendas, horarios configurables, disponibilidad y bloqueos. La Etapa 4 agrega creación, edición, confirmación y cancelación de turnos. La Etapa 5 agrega historias clínicas, revisiones clínicas inmutables y operaciones auditadas.

## Requisitos

- Node.js 22 o superior.
- Un proyecto Firebase con Authentication (correo/contraseña), Cloud Firestore y un bucket de Firebase Storage.
- Firebase CLI para desplegar reglas y funciones, y un runtime de Java para ejecutar Firestore Emulator.

## Desarrollo local

1. Instalá las dependencias de la aplicación:

   ```sh
   npm install
   ```

2. Copiá `.env.example` como `.env.local` y completá la configuración **web** del proyecto Firebase. Estos valores identifican el proyecto; no pongas claves de service account en variables `VITE_*`.

3. En Firebase Console, habilitá el proveedor de correo/contraseña y creá las cuentas del equipo. Verificá el correo de la cuenta administradora.

4. Iniciá la aplicación:

   ```sh
   npm run dev
   ```

Si no hay configuración, la aplicación mostrará un aviso y mantendrá el formulario deshabilitado. No se incluyen credenciales ni datos clínicos de demostración.

## Primer administrador

Las cuentas nuevas no pueden asignarse roles desde el navegador. El script inicial asigna de una vez los perfiles de Blas, Pamela y Marcela. Creá primero las tres cuentas en Firebase Authentication y prepará credenciales de Firebase Admin SDK en un entorno de confianza; no se exige que los correos estén verificados. Firebase CLI login no configura por sí solo Application Default Credentials.

En Firebase Console abrí **Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada**. La clave es un secreto: guardala fuera del repositorio, por ejemplo en `%LOCALAPPDATA%\\Firebase\\centro-odontologico-adminsdk.json`. Para acceso con privilegios mínimos, asigná a la cuenta de servicio permisos de administración de Firebase Authentication y lectura/escritura de Firestore (por ejemplo, roles **Firebase Authentication Admin** y **Cloud Datastore User**). También podés usar Application Default Credentials ya configuradas para ese proyecto.

En PowerShell:

```powershell
cd functions
$env:FIREBASE_PROJECT_ID = "centro-odontologico-colon"
$env:GOOGLE_APPLICATION_CREDENTIALS = "$env:LOCALAPPDATA\Firebase\centro-odontologico-adminsdk.json"
node scripts/set-roles.mjs `
  --dry-run `
  --blas-email "correo-de-blas" `
  --pamela-email "correo-de-pamela" `
  --marcela-email "correo-de-marcela"
```

El primer comando es de solo lectura y muestra UID, claims relevantes, campos de perfil, cambios propuestos y conflictos; `--dry-run` nunca modifica Firebase. Revisá que los tres UID y dentistId correspondan a las cuentas esperadas. Solo después, para aplicar los cambios, repetí el comando omitiendo expresamente `--dry-run`. El script no acepta contraseñas ni claves, rechaza cuentas duplicadas y conflictos de asignación. Permite migrar a Pamela y Marcela desde `role: dentist` únicamente cuando perfil y claims tienen ya su dentistId correcto. Tras una ejecución real, cada profesional debe cerrar sesión y volver a ingresar para refrescar el token. También se puede llamar a `npm run set:roles -- ...` desde `functions`.

## Datos de pacientes y seguridad

El proyecto predeterminado está fijado en `.firebaserc` como `centro-odontologico-colon`. Desde la raíz, con Firebase CLI autenticado:

```powershell
npx firebase-tools deploy --only firestore:rules,firestore:indexes,storage --project centro-odontologico-colon
```

Las reglas verifican que el rol y el identificador profesional del documento `users/{uid}` coincidan con los custom claims. Los tres profesionales pueden leer, crear y editar pacientes. Las escrituras se hacen en una transacción Firestore, junto con `patientDniIndex/{dniNormalizado}` y un registro mínimo en `auditLogs`; las reglas validan identidad, rol, campos, timestamps, vínculos y unicidad antes de aceptar la operación. Como Firestore Rules no puede calcular un hash, el documento auxiliar usa el DNI normalizado como ID y solo permite lecturas individuales a profesionales autenticados; no admite consultas/listados. Esto evita Cloud Functions para la gestión de pacientes, pero deja ese DNI visible en el ID del índice a los profesionales autorizados.

Los documentos `patients/{patientId}` tienen un ID aleatorio estable y los campos de ficha solicitados, referencias de autoría/auditoría, y campos normalizados de búsqueda. Las auditorías no guardan datos personales: registran entidad, ID de ficha, tipo de operación, UID del actor y timestamp. Editar un DNI cambia de forma atómica el índice auxiliar, sin cambiar el ID del paciente.

La lista inicial se pagina de a 30; la búsqueda se ejecuta en Firestore sobre campos de prefijo normalizados de nombre/apellido o DNI y no queda limitada a esa primera página. `firestore.indexes.json` incluye índices para agendas, bloqueos y consultas de perfiles profesionales.

## Agendas y disponibilidad

La ruta `/agenda` está disponible para los tres profesionales. Los tres pueden consultar y gestionar turnos de las tres agendas, configurar los horarios y administrar bloqueos. La identidad debe coincidir entre `users/{uid}` y los custom claims; esto no modifica UID ni claims.

La colección `schedules/{dentistId}` guarda el UID del profesional, horarios semanales, duración predeterminada, duraciones permitidas y excepciones de fecha. Si aún no existe configuración, la interfaz presenta como borrador el horario de referencia informado (lunes a viernes 08:00–15:00 y 16:00–20:30, fines de semana sin atención); se persiste al guardar. Los intervalos admiten pausas representadas por los espacios entre tramos. Todas las horas se interpretan en `America/Argentina/Tucuman`.

`scheduleBlocks/{blockId}` guarda bloqueos por profesional, fecha, rango, motivo, UID creador y timestamp del servidor. Antes de guardar se consultan los turnos del día y se advierte si hay superposición. Los bloqueos y turnos nuevos comparten reservas atómicas de intervalos de 15 minutos en `appointmentReservations/{dentistId}_{fecha}_{minuto}` para evitar que operaciones simultáneas ocupen el mismo intervalo. Los bloqueos que se superponen con turnos conservan la reserva del turno y quedan cubiertos por el registro del bloqueo para futuras reservas.

Los turnos se guardan en `appointments/{appointmentId}` y referencian al paciente únicamente por `patientId`; no duplican sus datos personales. Los nuevos documentos guardan además el `dentistId`, el UID del perfil profesional, fecha y horas locales, timestamps, duración, estado, motivo, observaciones y referencias de auditoría. Se crean como `pending`, pueden pasar a `confirmed` o `cancelled`, y las cancelaciones liberan sus reservas sin borrar el documento. La ficha de paciente se consulta desde el detalle del turno. Las operaciones importantes crean registros mínimos en `auditLogs`.

Las transacciones web vuelven a leer el horario y el paciente, validan el horario configurado, las excepciones, turnos y bloqueos, y reservan cada intervalo de 15 minutos en la misma transacción que guarda el turno. Las reglas aplican permisos por rol, verifican que el profesional destino tenga un perfil Firestore vigente coherente con su UID, y exigen reservas y auditoría consistentes. La lectura y escritura transaccional de esas reservas evita que dos operaciones concurrentes confirmen el mismo intervalo. Firestore Rules no evalúa dinámicamente todos los intervalos arbitrarios de horarios y excepciones: esa validación depende del cliente autenticado. Para garantizarla también frente a clientes modificados sería necesario un backend confiable; no se incorporaron Cloud Functions ni se cambió el plan de facturación. Las reglas no se desplegaron.

## Historias clínicas

`medicalRecords/{patientId}` contiene los antecedentes, con subcolecciones para `historyRevisions`, `consultations` y `treatments`; los tratamientos contienen `revisions` y `evolutions`. Las revisiones guardan el estado anterior y no pueden editarse ni borrarse. Crear o actualizar antecedentes, consultas, tratamientos, evoluciones y turnos requiere un documento nuevo en `auditLogs` dentro de la misma operación atómica. Los logs solo contienen entidad, identificador, operación, actor y fecha; no copian información médica o personal.

Los tres profesionales pueden gestionar historias clínicas y turnos compartidos. Las reglas exigen que el rol y `dentistId` de quien opera coincidan con su perfil y claims. La consulta de `users` se limita a los perfiles profesionales habilitados y no permite modificar documentos de usuario.

## Derivaciones, finanzas y archivos clínicos

Las derivaciones se guardan en `referrals` y contienen `patientId`, profesional que deriva/destinatario, motivo, estado y referencias de auditoría; no copian datos personales del paciente. Solo el profesional destinatario puede aceptar o rechazar una derivación pendiente.

Los presupuestos, conceptos y pagos se guardan en `budgets`, `budgetItems` y `payments`. Los importes se almacenan como centavos enteros; los pagos y la actualización de saldo se escriben en la misma transacción para evitar sobrepagos concurrentes. Aceptar/rechazar presupuestos y registrar conceptos o pagos exige auditoría atómica. No se integra una pasarela ni se cobran pagos en línea.

Los metadatos de archivos viven en `patientFiles` y los objetos privados en Firebase Storage bajo `patient-files/{patientId}/{extension}/{fileId}`. Se admiten PDF, JPG/JPEG, PNG, STL, PLY, OBJ y GLB hasta 100 MB. La carga crea primero un registro `uploading` auditado; Storage exige que coincidan el paciente, la extensión, el tamaño, el tipo MIME y el ID del archivo. Después se activa el metadato. La eliminación pasa por `deleting` y `deleted`, conserva el registro y las auditorías, y permite reintentar una eliminación incompleta. Los modelos STL/PLY/OBJ/GLB se visualizan localmente con Three.js; no se generan URLs públicas.

Los accesos de WhatsApp solo abren el enlace `wa.me` con un mensaje precompletado. El profesional debe revisarlo y enviarlo manualmente; la aplicación no envía mensajes ni registra un envío exitoso. La página Auditoría muestra los últimos 100 registros mínimos.

`firestore.indexes.json` incluye índices para agendas, perfiles, derivaciones, presupuestos, pagos y listados de archivos. `storage.rules` usa lecturas cruzadas de Firestore para validar perfil y metadatos. Esa característica debe probarse con los emuladores configurados antes de desplegar. Estas modificaciones son locales; no se desplegaron reglas ni índices.

## Verificación

```sh
npm run build
npm run lint
npm run test:patients
npm run test:schedules
npm run test:appointments
npm run test:clinical-records
npm run test:firestore-rules
npm run test:storage-rules
npm test
```

Las pruebas de reglas usan datos ficticios. Iniciá Firestore y Storage Emulator en una terminal:

```powershell
firebase emulators:start --only firestore,storage --project demo-sistcoc-firestore-rules-test
```

En otra terminal, desde la raíz del proyecto:

```powershell
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
$env:FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199"
npm run test:firestore-rules
npm run test:storage-rules
```

Para comprobar las Cloud Functions:

```sh
cd functions
npm install
npm run build
```

## Prueba manual

1. Iniciá sesión con cualquiera de los tres profesionales y abrí **Pacientes** desde el menú lateral.
2. Registrá una ficha solo con datos ficticios. El DNI se almacena normalizado y una segunda creación con ese DNI debe ser rechazada.
3. Buscá por prefijo de nombre, apellido o DNI. Si tenés más de 30 pacientes, confirmá que la búsqueda también encuentre fichas fuera de la primera página.
4. Abrí la ficha, editá un campo y verificá la actualización. Probá también cambiar el DNI por uno ficticio disponible y por el DNI de otra ficha.
5. Iniciá sesión con Pamela o Marcela y comprobá lectura/edición compartida. Confirmá que las escrituras directas a `auditLogs`, `patientDniIndex` inválidos, roles y turnos no permitidos sean rechazadas por reglas.
6. Iniciá sesión con las tres cuentas y verificá consulta/gestión de agendas, configuración de horarios y bloqueos compartidos.
7. Con datos ficticios, creá un turno pendiente para un paciente existente; probá solapamiento, bloqueo, horario fuera de agenda y duración no habilitada. Confirmá el turno y luego cancelalo; verificá que la reserva quede liberada y el registro permanezca como cancelado.
8. Editá un turno pendiente y uno confirmado, comprobando que los tres profesionales puedan gestionar y reasignar turnos de cualquier agenda. Verificá en `auditLogs` creación, edición, confirmación y cancelación.
9. En Historias clínicas, iniciá una ficha, registrá antecedentes, consultas y tratamientos de prueba; verificá las revisiones previas, evoluciones y logs sin datos clínicos. Confirmá que las revisiones no puedan actualizarse ni borrarse.
10. En la ficha de un paciente ficticio, creá una derivación y respondela con la cuenta destinataria; probá que el emisor no pueda responderla.
11. Creá un presupuesto con varios conceptos, aceptalo, registrá pagos parciales y comprobá que no se pueda superar el saldo.
12. Adjuntá un archivo PDF y un modelo 3D ficticios, probá su descarga/visor y la eliminación. No uses archivos con información clínica real durante pruebas.
13. Revisá la página **Auditoría** y prepará un mensaje manual desde la ficha o el detalle del turno; confirmá que WhatsApp no se envíe automáticamente.

Colecciones actuales: `users`, `patients`, `patientDniIndex`, `auditLogs`, `appointments`, `appointmentReservations`, `schedules`, `scheduleBlocks`, `medicalRecords`, `referrals`, `budgets`, `budgetItems`, `payments` y `patientFiles`. Firestore crea cada colección al guardar su primer documento. `appointmentReservations` contiene bloqueos técnicos por intervalos, sin información del paciente. Firebase Storage mantiene los binarios privados de adjuntos.

## Etapas del proyecto

1. Autenticación, usuarios y roles.
2. Base de datos y gestión de pacientes.
3. Agendas individuales y general.
4. Gestión completa de turnos.
5. Historias clínicas compartidas y cronológicas.
6. Dashboard y estadísticas.
7. Auditoría, seguridad y pruebas integrales.
