# PolarizadosYA! - Sistema de Gestión de Servicios Automotrices

## Problema Original
Diseñar y desarrollar una aplicación web responsive para la gestión de agendamiento y operación de servicios técnicos automotrices. La aplicación debe permitir administrar servicios como Polarizado, Nanocerámica, etc. con roles de usuario y un flujo operativo completo desde el agendamiento hasta la entrega.

## Fecha de última actualización
2026-06-01

## Última Sesión (2026-06-01) — Iteración 11 (Módulo Postventa / Garantías)
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
