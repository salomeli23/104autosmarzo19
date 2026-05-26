# PolarizadosYA! - Sistema de Gestión de Servicios Automotrices

## Problema Original
Diseñar y desarrollar una aplicación web responsive para la gestión de agendamiento y operación de servicios técnicos automotrices. La aplicación debe permitir administrar servicios como Polarizado, Nanocerámica, etc. con roles de usuario y un flujo operativo completo desde el agendamiento hasta la entrega.

## Fecha de última actualización
2026-05-22

## Última Sesión (2026-05-22) — Iteración 5 (Backend+Frontend)
- **NUEVO (P0):** PIN de Confirmación obligatorio al agendar cita
  - Default `00000`, configurable por **admin** en `/settings` (sección "PIN de Confirmación de Citas")
  - Validación 4-10 dígitos numéricos
  - Campo `data-testid="appointment-pin-input"` en formulario de Nueva Cita
- **NUEVO (P0):** Bloqueo de duplicados por **misma placa + misma fecha** (409 Conflict)
- **NUEVO (P0):** Hora de cita para HOY = siguiente intervalo libre **después** de la hora actual Colombia (respeta intervalo de franja). Si se agenda antes de que abra el slot, devuelve `slot_start`.
- **NUEVO (P0):** Componente `LiveTimer` (HH:MM:SS, actualiza cada segundo, congela si `endTime`)
- **NUEVO (P0):** Cronómetros en vivo en:
  - `/assign` (DraggableOrderCard): "En taller" (ingreso_at), "Corte" (cutting_started_at→cutting_completed_at), "Técnico" (assigned_at→service_completed_at)
  - `/cutting` (CuttingView): "En taller" en pending, "En corte" + "En taller" en in-progress
  - Bahía con orden activa muestra "En taller"
- **CORREGIDO (P0):** Las 10 bahías ahora son drop-zones funcionales en `/assign` (`useDroppable` de @dnd-kit) — antes no aceptaban drops.
- **EXTENDIDO:** `OrderResponse` incluye `cutting_status`, `cutting_started_at`, `cutting_completed_at`, `cutting_measurements`, `cutting_notes`, `bahia_id`, `bahia_name`.
- **CORREGIDO (P0):** PDF de Orden de Pedido en Check-in (`OrderPDFGenerator.js` con jsPDF nativo, sin `autoTable`).

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
