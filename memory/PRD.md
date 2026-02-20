# PolarizadosYA! - Sistema de Gestión de Servicios Automotrices

## Problema Original
Diseñar y desarrollar una aplicación web responsive para la gestión de agendamiento y operación de servicios técnicos automotrices. La aplicación debe permitir administrar servicios como Polarizado, Nanocerámica, etc. con roles de usuario y un flujo operativo completo desde el agendamiento hasta la entrega.

## Fecha de última actualización
2025-12-19

## Stack Tecnológico
- **Frontend:** React, Tailwind CSS, Shadcn/UI
- **Backend:** FastAPI, Python
- **Database:** MongoDB
- **Authentication:** JWT

---

## Flujo Operativo Implementado

### 1️⃣ Agendamiento (Estado: AGENDADO)
- Crear nueva cita con datos de cliente y vehículo
- Selección de servicios con precios sugeridos
- Valor negociado por el asesor
- Generación automática de código QR y código de cita
- ✅ **COMPLETADO**

### 2️⃣ Check-in / Ingreso (Estado: INGRESADO)
- Escaneo de QR con cámara o ingreso manual de código
- Modificación de servicios (upsell)
- Captura de firma digital del cliente
- Número de cédula obligatorio
- Foto del cliente (opcional)
- Descarga del QR para compartir
- ✅ **COMPLETADO**

### 3️⃣ Revisión 360° (Estado: EN_REVISION)
- Captura de múltiples fotos del vehículo
- Captura de video (opcional)
- Notas de inspección
- ✅ **COMPLETADO**

### 4️⃣ Asignación - Sesión Coordinador (Estado: ASIGNADO)
- Vista de vehículos en estado "En Revisión"
- Asignación de técnico
- Definición de tiempo estimado (timer)
- Opción de Desistimiento
- ✅ **COMPLETADO**

### 5️⃣ Sesión Técnico (Estado: EN_PROCESO → SERVICIO_COMPLETADO)
- Ver servicios asignados con timer
- Iniciar servicio
- Registrar observaciones
- Marcar como completado
- ✅ **COMPLETADO**

### 6️⃣ Facturación y Entrega
- Procesar pagos (múltiples métodos)
- Aplicar descuentos/bonos
- Estados finales:
  - TERMINADO_PAGADO
  - TERMINADO_FALTA_PAGO
  - ENTREGADO (con foto de entrega obligatoria)
- ✅ **COMPLETADO**

---

## Roles del Sistema

| Rol | Permisos |
|-----|----------|
| Admin | Acceso completo a todas las funcionalidades |
| Asesor | Agendamiento, Check-in, Revisión 360, Cotizaciones |
| Coordinador | Dashboard, Asignar Técnico, Ver Órdenes |
| Técnico | Dashboard, Mis Servicios |
| Facturación | Dashboard, Facturación/Entrega, Órdenes |

## Credenciales de Prueba

| Rol | Email | Contraseña |
|-----|-------|------------|
| Admin | admin@polarizadosya.com | admin123 |
| Asesor | asesor@polarizadosya.com | asesor123 |
| Coordinador | coordinador@polarizadosya.com | coord123 |
| Técnico | tecnico@polarizadosya.com | tecnico123 |
| Facturación | facturacion@polarizadosya.com | factura123 |

---

## Arquitectura de Archivos

```
/app/
├── backend/
│   ├── server.py              # API completa con flujo operativo
│   ├── requirements.txt
│   └── tests/
│       ├── test_polarizados_api.py
│       └── test_complete_flow.py
└── frontend/
    └── src/
        ├── components/
        │   ├── QRScanner.jsx        # Escáner de QR con cámara
        │   ├── QRDisplay.jsx        # Mostrar y descargar QR
        │   ├── SignaturePad.jsx     # Firma digital
        │   ├── CameraCapture.jsx    # Captura de fotos
        │   ├── OrderStatusBadge.jsx # Badge de estado
        │   └── Layout.jsx           # Navegación basada en roles
        ├── pages/
        │   ├── Appointments.jsx     # Agendamiento
        │   ├── CheckIn.jsx          # Check-in / Ingreso
        │   ├── Inspections.jsx      # Revisión 360°
        │   ├── Assign.jsx           # Asignar Técnico
        │   ├── TechnicianView.jsx   # Vista del técnico
        │   ├── Billing.jsx          # Facturación/Entrega
        │   └── ...
        └── lib/
            ├── api.js               # APIs centralizadas
            └── utils.js             # Utilidades
```

---

## Features Implementadas

### Backend
- ✅ Autenticación JWT con roles
- ✅ CRUD de órdenes con estados
- ✅ Validación de transiciones de estado
- ✅ Historial de cambios (trazabilidad)
- ✅ Sistema de alertas por rol
- ✅ Catálogo de servicios
- ✅ Endpoint seed para usuarios de prueba

### Frontend
- ✅ Tema oscuro con branding PolarizadosYA!
- ✅ Navegación basada en roles
- ✅ Scanner QR con cámara
- ✅ Descarga de QR
- ✅ Firma digital
- ✅ Captura de fotos
- ✅ Componentes responsive

---

## Estados del Sistema

```
AGENDADO → INGRESADO → EN_REVISION → ASIGNADO → EN_PROCESO → SERVICIO_COMPLETADO
                                                                     ↓
                                              TERMINADO_PAGADO / TERMINADO_FALTA_PAGO
                                                                     ↓
                                                                ENTREGADO

En cualquier momento (excepto ENTREGADO): → DESISTIMIENTO
```

---

## Backlog / Tareas Pendientes

### P1 - Alta Prioridad
- [ ] Notificaciones push en tiempo real (actualmente usa polling)
- [ ] Timer visual en la vista del técnico con alertas

### P2 - Media Prioridad
- [ ] Exportación PDF de órdenes/cotizaciones
- [ ] Sistema de bonos y promociones
- [ ] Captura de video en Revisión 360°

### P3 - Baja Prioridad
- [ ] Dashboard con métricas avanzadas
- [ ] Reportes estadísticos
- [ ] Integración calendario externo

---

## Notas Técnicas

- El QR code se genera en base64 y se almacena en la orden
- Las fotos se almacenan como data URLs (base64)
- El historial de cambios se guarda en la colección `order_history`
- Las alertas se crean por rol y se marcan como leídas individualmente
