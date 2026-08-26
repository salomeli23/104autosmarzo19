# PolarizadosYA! - Sistema de Gestión de Servicios Automotrices

## Problema Original
Diseñar y desarrollar una aplicación web responsive para la gestión de agendamiento y operación de servicios técnicos automotrices. La aplicación debe permitir administrar servicios como Polarizado, Nanocerámica, etc. con roles de usuario y un flujo operativo completo desde el agendamiento hasta la entrega.

## Fecha de última actualización
2026-08-26

## Última Sesión (2026-08-26 PM-4) — Iteración 25 (Retenciones + Tab Impuestos)

### Nuevo flujo en Facturación Electrónica
- **Botón "Aplicar retención"** ANTES del botón "Enviar Factura" (que queda bloqueado hasta aplicar).
- **Dialog Aplicar Retención**:
  - Ciudad (default Bogotá) — al cambiar de Bogotá, Reteica se desactiva.
  - **Reteica** (0.966% Bogotá) — activada por default cuando city=Bogotá.
  - **Retefuente** con presets 2.5% (servicios) y 6.9% (honorarios) + input libre.
  - Checkbox **"no aplica"** para clientes exentos (skip retenciones).
  - Checkbox **"Cambiar NIT/Cédula o Razón Social"** — reveal inputs; el cambio se propaga a TODAS las órdenes históricas y futuras del cliente (match por client_name o client_cedula previa).
  - Preview en vivo: Subtotal − Reteica − Retefuente = Neto a pagar.
- **Tab "Impuestos"** con card resumen (count, total Reteica, total Retefuente, total retenido) + búsqueda + listado detallado.

### Backend
- `POST /api/orders/{id}/apply-retention`: crea documento en `db.retentions`, actualiza `order.retention_applied=true` y `retention_snapshot`. Si `update_identity=true`, propaga NIT/razón social a todas las órdenes del cliente.
- `GET /api/retentions?q=`: reporte con items + summary agregado.
- `POST /api/orders/{id}/send-invoice-email` ahora **valida** que `retention_applied=true` (o `no_aplica=true`) antes de enviar → 400 si no.
- `GET /api/orders-pending-invoice` incluye `retention_applied` y `retention_snapshot`.

### Testing
- iteration_18.json: **8/8 pytest PASS + E2E frontend VERIFIED**. Único item menor: en tab Impuestos al primer mount hay un flash 0 antes de cargar (no crítico).

## Fecha de última actualización previa
2026-08-26

## Última Sesión (2026-08-26 PM-3) — Iteración 24 (Simplificar zonas en Completar Corte)

### Cambio UI
- **`CuttingView.jsx` · Completar Corte**: eliminados los dropdowns `part-material-{id}` y `part-rollo-{id}` de cada zona/pieza. Ahora cada bloque muestra únicamente:
  - Medida lineal (cm) 1–350
  - Checkbox "Aprovechamiento"
- El label superior cambió de "Medida lineal (cm), porcentaje y material por pieza" a "Medida lineal (cm) por pieza".
- El texto de ayuda se ajustó para reflejar que la referencia de material se toma del nuevo "Catálogo de Materiales" (tabs Material 1/2/3) y no por pieza.

## Fecha de última actualización previa
2026-08-26

## Última Sesión (2026-08-26 PM-2) — Iteración 23 (Catálogo Corte: Promedios + Materiales + Rollos)

### Módulo de Corte: nuevas capacidades en "Completar Corte"
- **Promedio sugerido de material** (auto-detect): al abrir el dialog, backend detecta marca+modelo de la orden y devuelve el promedio en metros. Matching insensible a acentos, mayúsculas, guiones y espacios (ej: "Mazda CX5" ~ "Mazda CX-5" ~ 1.51m). Fallback por substring del modelo si no hay match exacto.
- **Catálogo de Materiales con 3 tabs**:
  - **Material 1 · Polarizados** (30): Ultracarbon, Nanocerámica, Black Ceramic, Xtreme/Huperoptik, Ceramic I3/I3+, Ceramic XR Edge, Ceramic IR 3M, Ultraoptik.
  - **Material 2 · Seguridad / Ultrasecure** (9): Nanoseguridad, Clear Spectra, Ultrasecure 300/500/700/1500 micras, Windshield TPU.
  - **Material 3 · PPF** (16): Autobahn, XPEL, Avery, Spectra, Air Ceramic.
- **Seleccionar un item** muestra badge cyan "Seleccionado: XXX" (referencia visual para el operador).
- **51 rollos** cargados automáticamente en `/inventory` desde el xlsx del usuario (endpoint `POST /seed/cutting-catalog` admin, idempotente).

### Backend nuevo
- `/app/backend/cutting_catalog.py`: constantes CAR_AVERAGES (175+ items), MATERIALS_CATALOG (3 categorías), ROLLS_LIST (51 rollos) + `lookup_car_average()`.
- Endpoints: `GET /api/cutting/materials-catalog`, `GET /api/cutting/car-average?brand=&model=`, `GET /api/cutting/car-averages`, `POST /api/seed/cutting-catalog`.

### Testing
- iteration_17.json: **12/12 pytest PASS** (matching CX5~CX-5, idempotencia, 403 para no-admin) + **frontend E2E VERIFIED**: promedio Mazda CX-5 = 1.51m visible en dialog, 3 tabs navegables con counts correctos (30/9/16), selección/deselección de item funciona con badge.

## Fecha de última actualización previa
2026-08-26

## Última Sesión (2026-08-26 PM) — Iteración 22 (Fix bug: slot con label custom no aparecía)

### Bug reportado
Técnico Carlos tenía un slot asignado con `role='polarizado'` pero `label='Corte'` (rule 'Ultrasecure Polarizado'). En Vista Técnico la tab Corte quedaba VACÍA porque el mapeo solo consideraba el `role`.

### Fix aplicado
- **`TechnicianView.jsx`**: `slotSectionId(slot)` ahora prioriza **match por labelKeywords** primero, luego cae al role como fallback. Esto permite que reglas con roles genéricos pero labels específicos (ej: `role='polarizado' label='Corte'`) se agrupen en la sección correcta.
- **`SettingsSections.jsx`**: `AVAILABLE_ROLES` agrega opciones `corte` e `instalacion` (9 roles totales) para que el admin pueda crear reglas semánticamente correctas.

### Testing
- Retest en `iteration_16.json`: Fix **VERIFIED** por testing agent. BUGTST con slot label='Corte' aparece en tab Corte con badge=1; slot label='Instalación' en tab Instalación; regresión preservada para slots con label='Polarizado' (siguen en Instalación por keyword 'polariz'). Dialog Finalizar funciona E2E.

## Fecha de última actualización previa
2026-08-26

## Última Sesión (2026-08-26) — Iteración 21 (Vista Técnico rediseñada con secciones + timer + reporte)

### Vista Técnico (`/technician`) rediseñada
- **6 secciones por rol** (Tabs con alerta): **Corte**, **Instalación** (polarizado/ppf/ultrasecure), **Lavado**, **Accesorios**, **Detailing** (detailing/ceramico), **Latonería y Pintura**. Cada tab muestra un badge amarillo con el número de slots pendientes.
- **Alerta global**: header con "N servicio(s) pendiente(s)" en ámbar.
- **Card por slot** (`data-testid=slot-card-{id}`):
  - Placa (badge amarillo), rol del slot, marca/modelo, cliente.
  - Bloque "Tiempos" con `Ingreso`, `Programada`, y (al iniciar) `Inicio` + `Transcurrido`.
  - Timer en vivo: badge "Xm restantes" (verde/amarillo/naranja/rojo según `service_time_minutes`). Cuando se pasa: "+Xm excedido" en rojo.
  - Botón **Iniciar servicio** cuando `status=pendiente`.
  - Botón **Finalizar y enviar reporte** cuando `status=en_proceso`.
  - Cuando `status=completado`: badge verde y hasta 4 miniaturas de fotos del reporte.
- **Dialog Finalizar** con textarea de reporte obligatorio y uploader de hasta 10 fotos. Al confirmar → `POST /orders/{id}/route/slots/{slot_id}/complete` con `notes` + `completion_photos`. Si todos los slots quedan completados, la orden pasa a `servicio_completado` (lista para Autorizar Salida).

### Backend
- **`start_route_slot`**: acepta body opcional `{service_time_minutes}` y lo persiste en el slot (fallback a `order.service_time_minutes`).
- **`complete_route_slot`**: acepta body opcional `{notes, completion_photos}` (max 10) y los guarda en el slot.
- **`GET /api/orders`** (técnicos): filtro extendido a `$or` de `assigned_technician_id` **OR** `route_slots.technician_id` para que la lista incluya los slots asignados vía Hoja de Ruta.

### Técnicos disponibles
- Carlos Técnico → `tecnico1@polarizadosya.com` / `tecnico123`
- Pedro Técnico → `tecnico2@polarizadosya.com` / `tecnico123`
- Juan Técnico → `tecnico@polarizadosya.com` / `tecnico123`

## Fecha de última actualización previa
2026-08-25

## Última Sesión (2026-08-25 PM-2) — Iteración 20 (Sunroof editable en Check-in)

### Sunroof adicional editable en Check-in / Ingreso
- **Frontend `CheckIn.jsx`**:
  - Nuevo estado `extraPriceOverrides` (por id de extra).
  - `applicableExtras()` aplica el override si el asesor cambia el valor.
  - En el desglose del total, el extra Sunroof (`trigger_part='sunroof'` o nombre contiene "sunroof") se renderiza como **Input numérico editable** (`data-testid=extra-price-input-{id}`) en lugar de texto fijo. Otros extras siguen como texto fijo.
  - Precarga automática: al buscar la orden por código, los extras que venían del agendamiento se cargan en `selectedServices[i].extras` y el `sunroof_price` se rellena en `extraPriceOverrides`.
  - Total se recalcula en vivo al cambiar el valor.
- **Backend**: `IngresoApproval` ya soporta `services[i].extras=[{id,nombre,price}]` — el precio ajustado en check-in se persiste tal cual el asesor lo dejó.
- Verificación E2E: crear cita prioridad con sunroof 150k → check-in muestra input con 150000 → editar a 250000 → total pasa de $450k a $550k automáticamente.

## Fecha de última actualización previa
2026-08-25

## Última Sesión (2026-08-25 PM) — Iteración 19 (Prioridad + Ultrasecure Refino)

### Prioridad: check-in inmediato con hora Colombia
- **Backend**: `create_order` para prioridad usa `get_colombia_time()` (pytz UTC-5) para el `scheduled_time` — consistente con `validate_checkin_time`.
- **Backend `checkin_order`**: si `order.is_priority=true` se BYPASSA `validate_checkin_time` (no hay gate por franja/hora). Testeado E2E: crear cita prioridad → checkin inmediato → 200 OK.

### Ultrasecure: opción "Completo" + Sunroof abierto
- **`VEHICLE_PARTS` en Appointments.jsx**: eliminada la pieza `vidrio_trasero` (redundante). Quedan 9 partes: Panorámico, Vidrio Copiloto/Piloto, Vidrio Trasero Piloto/Copiloto, Trasero, Luneta, Sunroof, Custodias.
- **Botón "Completo"** por servicio: `data-testid=select-all-parts-{serviceId}`. Marca/desmarca las 9 partes de una vez. Al estar todo marcado muestra "✓ Completo" en verde.
- **Sunroof adicional con costo abierto**: cuando se selecciona la pieza `sunroof` aparece un bloque ámbar con input numérico `data-testid=sunroof-price-{serviceId}` para ingresar el valor extra. Este valor se suma automáticamente al total y se envía al backend como `extras=[{id:'sunroof', nombre:'Sunroof (adicional)', price}]` dentro del servicio.
- Aplica para AMBOS tipos de cita (franja y prioridad).

## Fecha de última actualización previa
2026-08-25

## Última Sesión (2026-08-25) — Iteración 18 (Cita por Prioridad)

### Nueva Cita: Tipo "Por Franja" | "Por Prioridad"
- **Backend `/api/orders` (POST)**:
  - `OrderCreate` acepta `is_priority: bool`, `authorization_code: str`, `priority_reason: Optional[str]`.
  - Si `is_priority=false` (default): valida `confirmation_pin` como antes (setting `booking_pin`).
  - Si `is_priority=true`: valida `authorization_code` contra setting `priority_pin` (default `00000`). Bypassa la franja: `time_slot="prioridad"` y `scheduled_time = HH:MM Colombia now` (UTC-5).
  - Errores: 400 "Código de autorización requerido" / "Código de autorización inválido".
  - `OrderResponse` expone `is_priority`, `priority_reason`.
- **Frontend `/appointments`**: Dialog "Nueva Cita" ahora tiene un selector arriba "Tipo de Cita" con dos tarjetas (`appointment-type-franja` / `appointment-type-prioridad`). Al elegir Prioridad:
  - Se oculta el selector de franja horaria.
  - Aparece banner amber: "Prioridad: se agenda inmediatamente sin importar franjas ni cupos".
  - Aparece input `appointment-auth-code-input` (código de autorización) + `appointment-priority-reason` (motivo opcional).
  - El PIN de confirmación normal queda oculto.
- **Testing curl**: 4 escenarios validados: prioridad sin código → 400; prioridad código inválido → 400; prioridad con `00000` → 200 (agenda con hora actual Colombia); franja sin PIN → 400.

## Fecha de última actualización previa
2026-08-21

## Última Sesión (2026-08-21) — Iteración 17 (Pagos · Facturación E. · Autorizar Salida · Emails con PDF)

### Módulo de Pagos (`/pagos`)
- **Backend**: `POST /api/payments` acumula abonos en `order.amount_paid`. Valida que el monto no exceda saldo. Al completar saldo → `ready_for_delivery=true` y status → `terminado_pagado`. `GET /api/payments` (con filtro `q` por placa/cédula/cliente/orden). `GET /api/orders-with-balance?only_pending=&q=` lista órdenes con saldo (rango 200 más recientes). `GET /api/payments/order/{id}` historial por orden.
- **Frontend**: Tabs Órdenes / Historial. Buscador por placa, cédula, cliente. Toggle "Solo pendientes". Dialog "Registrar abono" con monto pre-cargado al saldo, método (efectivo/tarjeta/transferencia/nequi/daviplata), referencia, notas. Envía email de estado de cuenta con PDF si hay `client_email`.
- data-testids: `pagos-page`, `tab-orders-btn`, `tab-history-btn`, `pagos-search-input`, `filter-pending-btn`, `pay-btn-{id}`, `pay-amount-input`, `pay-method-select`, `confirm-pay-btn`.

### Clientes por Facturar (`/facturacion-electronica`)
- **Backend**: `GET /api/orders-pending-invoice` lista órdenes `requires_invoice=true` y `invoice_sent_at=null`. `POST /api/orders/{id}/send-invoice-email` envía Factura Electrónica MOCK (PDF con numeración simulada `MOCK-FE-YYYYMMDD-{code}`) via Resend con adjunto PDF. Marca `invoice_sent_at`/`invoice_number`.
- **Frontend**: Solo muestra clientes con factura electrónica solicitada. Input para agregar correo si el cliente no lo tiene. Botón "Enviar Factura (MOCK)" deshabilitado sin email. Badge "Modo MOCK activo" avisa que es de prueba hasta conectar Siigo real.
- data-testids: `facturacion-page`, `invoice-row-{id}`, `invoice-email-input-{id}`, `send-invoice-btn-{id}`.

### Autos por Autorizar Salida (`/autos-salida`)
- **Backend**: `GET /api/orders-pending-release` lista órdenes en `servicio_completado`/`terminado_pagado`/`terminado_falta_pago` no entregadas. `POST /api/orders/{id}/authorize-release` FALLA con 400 si `balance > 0` ("No se puede autorizar salida: falta pago"). Marca `release_authorized_at`, `release_authorized_by_name`.
- **Frontend**: Dos secciones: Pendientes y Ya autorizados. Cards muestran badge "Falta por pago" (rojo) si balance>0, "Listo para autorizar" (cyan) si balance=0, "Autorizado" (verde) si ya se autorizó. Botón "Autorizar salida" deshabilitado hasta que saldo sea $0.
- data-testids: `autos-salida-page`, `salida-row-{id}`, `falta-pago-{id}`, `authorize-btn-{id}`.

### Emails automáticos (Resend + PDFs reportlab)
- **Nuevo helper** `/app/backend/pdf_utils.py`: `build_ingreso_receipt` (Recibo firmado con saldo pendiente), `build_payment_statement` (Estado de cuenta), `build_mock_invoice` (Factura DIAN MOCK). Usa reportlab 4.2.5.
- **Triggers**:
  - **Check-in aprobado**: `POST /api/orders/ingreso-approval` ahora envía correo con PDF recibo firmado + foto frontal (si hay email).
  - **Pago registrado**: `POST /api/payments` envía estado de cuenta PDF con historial de abonos y saldo.
  - **Reenvío manual**: `POST /api/orders/{id}/send-ingreso-receipt` reenvía recibo + fotos 360° (hasta 8 fotos por límite Resend ~25MB).
  - **Factura**: `POST /api/orders/{id}/send-invoice-email`.

### Fix P0: Vista Técnico soporta Hoja de Ruta (`route_slots`)
- **Frontend `/technician`**: filtro extendido — muestra órdenes donde `assigned_technician_id === user.id` (legacy) O donde algún `route_slots[i].technician_id === user.id` con status ≠ completado. Nueva sección "Hoja de Ruta" al top de la vista lista órdenes de multi-técnico con botones "Iniciar slot"/"Completar slot" por cada slot asignado al técnico. Timers Ingreso y Corte visibles.
- data-testids: `route-order-{id}`, `start-slot-{slot_id}`, `complete-slot-{slot_id}`.

### Ajuste Check-in: Sunroof solo en Ultrasecure
- **Frontend `CheckIn.jsx`**: `applicableExtras()` ahora filtra extras cuyo `trigger_part='sunroof'` o `nombre` contiene "sunroof" para que solo apliquen si hay algún servicio Ultrasecure seleccionado. Sin Ultrasecure → el costo Sunroof NO se agrega al total aunque la parte esté marcada.

### Seed de datos de prueba
- `POST /api/seed/test-orders` (admin): crea 3 órdenes idempotentes ABC123 (saldo 600k), XYZ789 (balance 0, requires_invoice), GHI456 (balance 650k, requires_invoice) para probar los 3 módulos.

### Tests
- **64/64 pytest** (16 nuevos iter14 + 48 regresiones). Frontend verificado: /pagos con dialog, /facturacion-electronica con MOCK send, /autos-salida con gate por saldo. Reporte: `/app/test_reports/iteration_14.json`.

## Fecha de última actualización previa
2026-06-10

## Última Sesión (2026-06-10) — Iteración 16 (Consejo de Corte + Sedes/Sucursales)

### Consejo de Corte (auto-rellena medidas por serie)
- **Backend**: CRUD `/api/car-series` (brand, model, version, part_measurements={part_id:cm}, notes) + `/api/car-series/suggest?brand=&model=` con regex case-insensitive parcial.
- **Frontend**: Sección "Series de Autos" en `/settings` con dialog de CRUD y campos por las 10 piezas. En `/cutting` > Completar Corte aparece bloque amarillo "💡 Consejo de Corte" con select de series sugeridas según `order.brand+model` y botón "Aplicar medidas" que auto-rellena los selects de medida.

### Sedes / Sucursales + Inventario por sede
- **Backend**: CRUD `/api/sedes` (admin only), `POST /api/inventory/{id}/transfer-sede` (admin/corte/coord) que persiste el movimiento en `inventory_movements`, `PUT /api/users/{id}/sede` para vincular usuarios a sede. Campo `sede_id`/`sede_nombre` agregado a `db.inventory` y `db.users`.
- **Frontend**: Sección "Sedes/Sucursales" en `/settings` con CRUD + lista de asignación rápida de sede por usuario. En `/inventory`: campo Sede en el form de crear rollo + botón "Mover sede" (icono Move) que abre dialog con select de sede destino. Cada item muestra etiqueta `sede_nombre` si está asignada.

### Tests
- **48/48 pytest** (17 nuevos iter13 + 31 regresiones). Frontend 100% verificado: CRUD sedes + car series + asignación usuarios; create rollo con sede + transferir entre sedes; consejo de corte aplica medidas a partir de serie sugerida.
- Reporte: `/app/test_reports/iteration_13.json`.

## Sesión anterior (2026-06-04 PM-2) — Iteración 15 (Selects 1-350cm, Aprovechamientos, Fix porcentajes)
- **FIX P0 (bug visible):** `/api/cutting/pending` no incluía `part_percentages` al construir `cutting_services` → ahora SÍ se incluye, los porcentajes elegidos en check-in aparecen como badges (data-testid `part-pct-<id>`) en cada pieza al completar corte.
- **NUEVO (P0):** Medidas con selects **Largo (cm)** y **Ancho (cm)** ambos 1-350 cm en lugar del input de texto. Estado independiente `partDims` por pieza para evitar resets.
- **NUEVO (P0):** Checkbox **♻ Aprovechamiento** por pieza. Si está marcado:
  - NO se descuenta del stock del rollo
  - Se guarda registro en colección `db.aprovechamientos` (order_id, part_id, measurement, meters, tipo_rollo, source_inventory_item_id, plate, client_name, user, status, created_at)
  - Visual: fondo morado en el bloque + texto "Registrado en base de aprovechamientos"
- **NUEVO (P1):** Filtro de `/api/cutting/pending` ampliado con 'polarizado', '3m', 'crystalline', 'mixto' (issue pre-existente identificado en iter11).
- **NUEVO endpoint:** `GET /api/aprovechamientos` (admin/corte/coordinador) lista los aprovechamientos registrados ordenados DESC.
- **Tests:** 31/31 pytest (10 iter12 nuevos + 21 regresiones). Backend 100%, frontend bug detectado y corregido (selects 1-350 ahora persisten).

## Sesión anterior (2026-06-04 PM) — Iteración 14 (Completar Corte con porcentaje + material + marca por pieza)
- **NUEVO (P0):** Dialog "Completar Corte" rediseñado. Cada pieza muestra:
  - **Badge de porcentaje** elegido por el cliente en el check-in (lookup en `cutting_services[].part_percentages[part_id]`). data-testid `part-pct-<id>`.
  - **Select Material** (tipo de rollo: Spectra, Black Ceramic, Ceramic i3, Huperoptik, Clear, PPF Xpel/Autoban/Techo, etc.). data-testid `part-material-<id>`.
  - **Select Marca/Rollo** filtrado por material, mostrando código + nombre + metros restantes (ej "INV-00018 · Spectra Premium (29.00m)"). data-testid `part-rollo-<id>`.
  - Mini-info bajo cada bloque: "Spectra · INV-00018 · quedan 29.00m". data-testid `part-rollo-info-<id>`.
- **NUEVO (P0):** Backend acepta `part_materials = {part_id: {tipo_rollo, inventory_item_id}}` en `PUT /api/cutting/{id}/complete` y descuenta los metros de cada rollo según las medidas de las piezas asignadas. Si dos piezas usan el mismo rollo, los metros se SUMAN en un solo movimiento.
- **NUEVO (P0):** Respuesta del endpoint trae `inventory_deduction.multi = [{item_id, rollo_codigo, rollo_nombre, tipo_rollo, meters_used, new_remaining}]` cuando hay más de un rollo descontado.
- **PERSISTENCIA:** `order.cutting_part_materials` se guarda y se expone en `OrderResponse`.
- **COMPATIBILIDAD:** Modo legacy (un solo `inventory_item_id` agregado) sigue funcionando si no se envía `part_materials`.
- **Tests:** 21/21 pytest (4 iter11 + 17 regresiones). Frontend con 9 part-blocks + filtros de material + info live de metros restantes verificados.

## Sesión anterior (2026-06-04) — Iteración 13 (Autos por Asignar + PlateBadge + Foto Perfil)
- **NUEVO (P0):** Página `/auto-asignar` (admin, coordinador) — drag & drop de órdenes en `en_revision` desde columna "Cola sin asignar" a columnas por técnico. Dialog pide tiempo promedio en minutos. Persiste `pre_assigned_technician_id/name/service_time_minutes/pre_assigned_at` SIN cambiar status. UI con dnd-kit + indicadores: "Ingresó hace X" y "Asignado hace Y · Z min est."
- **NUEVO (P0):** Endpoints `GET /api/tech-queue/pending`, `GET /api/tech-queue/by-technician`, `POST /api/tech-queue/pre-assign`, `POST /api/orders/{id}/clear-pre-assignment`.
- **REGLA P0:** `PUT /api/cutting/{id}/start` ahora rechaza con 400 si la orden no tiene `pre_assigned_technician_id` ni `assigned_technician_id`. **No se puede iniciar corte sin técnico asignado.**
- **NUEVO (P0):** Foto frontal del vehículo OBLIGATORIA en Check-in. Campo `profile_photo_url` validado por backend en `/orders/ingreso-approval` (400 si falta). Fallback: si no se setea en check-in, la primera foto de la Revisión 360° se copia automáticamente.
- **NUEVO (P0):** Componente `PlateBadge` (amarillo, letra negra, font-mono, prominente) reemplaza la placa en /appointments, /service-orders, /technician, /auto-asignar, dialogos.
- **NUEVO (P0):** Componente `CarAvatar` muestra `profile_photo_url` como mini-avatar (o icono de auto si falta) en /appointments, /service-orders, /technician, /auto-asignar.
- **NUEVO (P0):** Botón "Enviar X foto(s) al cliente por email" (data-testid `send-inspection-photos-btn`) en el step de éxito del wizard Check-in+360.
- **MENÚ:** Removido item "Revisión 360°". Agregado "Autos por Asignar". "Asignar Técnico" renombrado a "Asignar Bahía" (apunta a /assign).
- **Tests:** 17/17 pytest (8 iter10 nuevos + 9 regresiones). Frontend: 18 plate-badges en /auto-asignar, 37 en /appointments, 111 en /service-orders. Menú validado.

## Sesión anterior (2026-06-03) — Iteración 12 (Wizard Check-in+360 + Timers)
- Fusión Check-in + Revisión 360° en un solo wizard (componente Inspection360Inline)
- Panel de Tiempos en cards del Técnico con relojes en vivo
- Fix: tags del asesor visibles en /appointments (helper slotIdForOrder)
- Fix: OrderResponse expone service_completion_photos/notes

## Sesión anterior (2026-06-01) — Iteración 11
- Módulo Postventa / Garantías (búsqueda por placa, salto de facturación)
- Vista Técnico con completar servicio + fotos + liberación automática de bahía
- Porcentajes de polarizado por parte en Check-in (5%-70% + N/A)
- Tag de asesor (`created_by_name`) propagado a citas y órdenes

## Sesión anterior (2026-05-29) — Iteración 10
- Módulo de Inventario con alertas de bajo stock por 13 tipos de rollos
- Descuento automático del inventario al completar Corte

## Sesión anterior — Iteración 9 (2026-05-28)
- Liberar Bahía con PIN, observaciones y hasta 10 fotos
- PIN de Completar Servicio configurable
- **NUEVO (P0):** Página `/postventa` (admin/asesor/coordinador) con:
  - **Búsqueda por placa** → muestra datos del cliente y vehículo + historial de servicios anteriores con status, fecha, hora, servicios, valor
  - **Dialog "Agendar Postventa / Garantía"** con: select de tipo (Garantía | Postventa/Revisión), fecha, motivo libre, franja horaria, PIN
  - Pre-rellena automáticamente datos del cliente y vehículo desde el último servicio
- **NUEVO (P0):** Backend `GET /api/orders/history-by-plate/{plate}` devuelve datos del cliente + lista de órdenes anteriores
- **CAMBIO:** `OrderCreate` y `Order` soportan `is_postventa`, `postventa_type`, `postventa_motivo`, `original_order_id`
- **REGLA:** Si `is_postventa=true`:
  - No bloquea por duplicado de placa+fecha
  - Al completar servicio (por técnico o al liberar bahía) → status pasa **directamente a `entregado`** (salta facturación). `ready_for_delivery=true` y `delivered_at` se setean automáticamente
  - Valor negociado = $0

## Sesión anterior (2026-05-29) — Iteración 10
- Módulo de Inventario con alertas de bajo stock por 13 tipos de rollos
- Descuento automático del inventario al completar Corte
- 5 endpoints CRUD + alerts + deduct + movements
- **NUEVO (P0):** Página `/inventory` (admin/coordinador/corte) con:
  - Tarjeta de **alertas de bajo stock** por tipo de rollo (13 tipos pre-configurados con sus umbrales: Spectra ≤5, Black Ceramic ≤5, Ceramic i3 ≤3, Upper Hoptik ≤3, Edge ≤3, Clear 4mil ≤5, Clear 7mil ≤2, Clear 12mil ≤2, Clear 1500 micras ≤4, Xpel Gloss ≤4, PPF Xpel Ultimate ≤2, PPF Autoban ≤4, PPF Techo ≤3) con severidad (critical/high/medium)
  - Tabs Rollos / Accesorios-Materiales con barra de progreso de metros restantes por rollo
  - Filtro por categoría
  - Dialog Nuevo/Editar artículo con campos: nombre, categoría, tipo (rollo/cantidad), tipo_rollo (select de 13 marcas), factura, metros_iniciales o cantidad_inicial, costo, servicio vinculado, notas
- **NUEVO endpoints backend:**
  - `POST/GET/PUT/DELETE /api/inventory` (admin para create/update/delete)
  - `GET /api/inventory/alerts` — alertas de bajo stock con conteos y metros
  - `POST /api/inventory/{id}/deduct` — descuento manual (rollos por metros, accesorios por cantidad)
  - `GET /api/inventory/movements` — historial de movimientos
- **NUEVO (P0):** **Descuento automático al completar Corte**. En el dialog de "Completar Corte" se añadió un select "Rollo utilizado" que lista todos los rollos con metros > 0. Al confirmar, se descuenta automáticamente del inventario (cálculo automático sumando la dimensión mayor de cada medida en cm → metros). Permite override manual de metros.
- **CAMBIO:** Endpoint `PUT /api/cutting/{id}/complete` ahora acepta `inventory_item_id` y `meters_used`, devuelve `inventory_deduction` con detalles del descuento.
- **CAMBIO:** Código consecutivo de artículos: `INV-00001`, `INV-00002`, etc.

## Sesión anterior — Iteración 9 (2026-05-28)
- Liberar Bahía con PIN, observaciones y hasta 10 fotos
- PIN de Completar Servicio configurable
- Facturación con "Legalizar Pago" + ready_for_delivery
- **NUEVO (P0):** Endpoint `/bahias/{id}/release` ahora acepta body con `completed`, `completion_pin`, `notes`, `completion_photos` (hasta 10). Si `completed=true`:
  - Valida PIN configurable (default `11111`)
  - Cambia status de la orden a `servicio_completado` (cola de Facturación)
  - Guarda fotos en `service_completion_photos`
  - Envía email al cliente y a todos los coordinadores con fotos comprimidas + observaciones
  - Si `completed=false` (falta algo): solo libera la bahía, la orden queda asignada esperando otra bahía, guarda en `service_pending_notes`
- **NUEVO (P0):** PIN de Completar Servicio configurable por admin en `/settings` (endpoints `/settings/completion-pin` GET/PUT). Tarjeta verde junto al PIN amarillo de citas.
- **NUEVO (P0):** Dialog "Liberar Bahía" en `/assign` con:
  - 2 opciones: "Servicio Concluido" (verde) | "Falta algo" (amarillo)
  - Si concluido: PIN + observaciones + uploader de hasta 10 fotos
  - Si falta: solo textarea con la observación
- **CAMBIO:** `/orders/payment` ahora marca `ready_for_delivery=true` al legalizar pago y devuelve mensaje "Pago legalizado - Listo para entrega".
- **NUEVO:** Endpoint `GET /api/billing/pending` para listar las órdenes en cola de Facturación.
- **CAMBIO:** Botón "Procesar Pago" en `/billing` renombrado a **"Legalizar Pago"**. Dialog ahora se titula "Legalizar Pago" y el botón final dice "Legalizar y enviar a Entrega".

## Sesiones anteriores
- Iteración 8 (2026-05-26 PM): Medidas por pieza + serie PPF en Completar Corte
- Iteración 7 (2026-05-26 AM): Flujo estricto Check-in → Revisión 360° → Corte → Técnico + PDF auto
- Iteración 6: Intervalo 15 min, Check-in por placa, Email de fotos con compresión
- Iteración 5: PIN de citas, duplicados, LiveTimer, 10 bahías drop-zones
- **NUEVO (P0):** En "Completar Corte" ahora se piden **9 medidas por pieza (cm)**: Panorámico, Vidrio Copiloto, Vidrio Piloto, Vidrio Trasero, Vidrio Trasero Copiloto, Trasero, Luneta, Sunroof, Custodias. Las piezas seleccionadas en el check-in resaltan con borde cyan.
- **NUEVO (P0):** Campo de **Observación** (textarea) en Completar Corte.
- **NUEVO (P0):** Para servicios **PPF**, se solicita **Serie y Modelo del vehículo** (campos requeridos). Se guarda en `ppf_vehicle_serial` y `ppf_vehicle_model` en la orden.
- **CAMBIO:** Endpoint `PUT /api/cutting/{id}/complete` ahora acepta JSON body con `part_measurements`, `notes`, `ppf_vehicle_serial`, `ppf_vehicle_model` (manteniendo compat con query params legacy).
- **CAMBIO:** El backend genera automáticamente `cutting_measurements` (texto legible) concatenando las medidas por pieza si no se envía explícito.
- **CONFIRMADO:** Solo hay 10 bahías activas en BD (Bahía 1-10).

## Última Sesión (2026-05-26 — AM) — Iteración 7 (Flujo Estricto + PDF Auto)
- Descarga automática del PDF al aprobar el check-in
- Error estructurado al buscar orden ya ingresada (card roja con datos completos)
- Bloqueo de asignación al técnico si polarizado/PPF no completó corte
- Corte ahora consume órdenes en estado `en_revision` (después de Revisión 360°)
- Validaciones de estado en `/cutting/{id}/start` y `/cutting/{id}/complete`
- Kanban /service-orders con 8 columnas etiquetadas

## Sesión Anterior (2026-05-26) — Iteración 6
- Intervalo fijo 15 min entre citas
- Check-in busca por código O placa
- Envío de fotos de Revisión 360° por email (con compresión Pillow)
- Eliminado "Excelente" del checklist; max 20 fotos

## Sesión Iteración 5 (2026-05-22)
- PIN de Confirmación, duplicados por placa+fecha
- LiveTimer en /assign y /cutting
- 10 Bahías como drop-zones
- PDF de Orden de Pedido

## Sesión Anterior (2026-05-21)
- **NUEVO:** Módulo de Corte de Piezas (`/cutting`)
  - Vista para servicios de Polarizado y PPF después del check-in
  - Estados: Pendiente → En Proceso → Completado
  - Campos para medidas y notas
  - Notificaciones para coordinador cuando corte está listo
- **NUEVO:** Rol de usuario "Corte" (corte@polarizadosya.com / corte123)
- **NUEVO:** Sistema de Bahías (10 garages para asignación)
- **NUEVO:** Generación de PDF "Orden de Pedido" en Check-in
- **NUEVO:** Estado "en_corte" en el flujo de órdenes
- **CORREGIDO:** Selección de servicios en Check-in
- **CORREGIDO:** Lógica de franjas horarias disponibles

## Stack Tecnológico
- **Frontend:** React, Tailwind CSS, Shadcn/UI
- **Backend:** FastAPI, Python
- **Database:** MongoDB
- **Authentication:** JWT

---

## Flujo Operativo Implementado

### 1️⃣ Agendamiento (Estado: AGENDADO)
- Crear nueva cita con datos de cliente y vehículo
- **Sistema de franjas horarias con cupos:**
  - Lunes-Viernes: 3 franjas (08:30-11:30: 20 autos, 11:30-14:30: 10 autos, 14:30-16:00: 10 autos)
  - Sábados: 3 franjas (07:30-11:00: 20 autos, 11:00-14:00: 12 autos, 14:00-15:30: 8 autos)
  - Domingos: Cerrado
- Selector de fecha con calendario integrado
- Catálogo de servicios organizado por categorías con precios manuales
- Generación automática de código QR y código de cita
- ✅ **COMPLETADO**

### 2️⃣ Check-in / Ingreso (Estado: INGRESADO)
- Escaneo de QR con cámara o ingreso manual de código
- **Validación de hora Colombia (UTC-5):** No permite check-in antes de la franja asignada
- Modificación de servicios (upsell)
- Captura de firma digital del cliente
- Número de cédula obligatorio
- Foto del cliente (opcional)
- ✅ **COMPLETADO**

### 3️⃣ Revisión 360° (Estado: EN_REVISION)
- Captura de múltiples fotos del vehículo
- Captura de video (opcional)
- Notas de inspección
- ✅ **COMPLETADO**

### 4️⃣ Asignación - Sesión Coordinador (Estado: ASIGNADO)
- Vista de vehículos por estado con tabs
- Asignación de técnico con tiempo estimado
- **Opción de Desistimiento de Servicio**
- ✅ **COMPLETADO**

### 5️⃣ Sesión Técnico (Estado: EN_PROCESO → SERVICIO_COMPLETADO)
- Ver servicios asignados
- Iniciar servicio
- Registrar observaciones
- Marcar como completado
- ✅ **COMPLETADO**

### 6️⃣ Facturación y Entrega
- Procesar pagos
- Estados: TERMINADO_PAGADO, TERMINADO_FALTA_PAGO, **FACTURADO Y ENTREGADO**
- Foto de entrega obligatoria
- ✅ **COMPLETADO**

---

## Catálogo de Servicios (Actualizado)

### Polarizado/Ultrasecure
- Nanooptik, Black Ceramic Autobahn, Ultraoptik ASWF
- Ceramic i3 Autobahn, Ceramic i3+ Autobahn, Huperoptik
- Mixto, 300/500/700/1000/1700 Micras

### PPF
- Matte, Brillante, Negro Mate, Vinilo, Graph

### Accesorios
- Seguros de Luna/Guaya/Llanta
- Tuercas I/MG, Pernos I/MG
- Plumillas, Glass Cleaner, Opulum, Hidrofilms
- Cámaras de seguridad (4K/HD), Tiros de arrastre
- Cadenas (Kryptonite/Defender)
- Tapetes Termoformado/Defender

### Detailing
- Polichado Profesional
- Cerámico 3/5 años
- Lavado (general/interior/chasis/cojinería)
- Mantenimiento Cerámico
- Cerámico (cojinería/plásticos/vidrios)
- Corrección de Pintura

### Latonería y Pintura
- Corrección de Farolas, PDR, Latonería

---

## Roles y Credenciales

| Rol | Email | Contraseña |
|-----|-------|------------|
| Admin | admin@polarizadosya.com | admin123 |
| Asesor | asesor@polarizadosya.com | asesor123 |
| Coordinador | coordinador@polarizadosya.com | coord123 |
| Técnico | tecnico@polarizadosya.com | tecnico123 |
| Facturación | facturacion@polarizadosya.com | factura123 |

---

## APIs Principales

### Slots/Disponibilidad
- `GET /api/slots/availability?date=YYYY-MM-DD` - Franjas con cupos
- `GET /api/time/colombia` - Hora actual de Colombia

### Servicios
- `GET /api/services/catalog` - Catálogo por categorías
- `GET /api/services/catalog/flat` - Lista plana de servicios

### Órdenes
- `POST /api/orders` - Crear cita
- `POST /api/orders/checkin` - Check-in (valida hora)
- `POST /api/orders/{id}/desistimiento` - Cancelar orden

---

## Backlog

### P1 - Alta Prioridad
- [ ] Timer visual en vista del técnico con alertas de retraso
- [ ] Notificaciones push en tiempo real

### P2 - Media Prioridad  
- [ ] Exportación PDF de órdenes
- [ ] Captura de video en Revisión 360°
- [ ] Sistema de bonos y promociones

### P3 - Baja Prioridad
- [ ] Dashboard con métricas avanzadas
- [ ] Reportes estadísticos
- [ ] Integración calendario externo

---

## Notas Técnicas
- Hora de Colombia: UTC-5 (validación en backend)
- QR code en base64
- Fotos como data URLs
- Historial en colección `order_history`
