import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ordersAPI, servicesAPI, slotsAPI, notificationsAPI, paymentsAPI, discountCodesAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Calendar } from '../components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../components/ui/accordion';
import { OrderStatusBadge } from '../components/OrderStatusBadge';
import { ServiceBadge } from '../components/ServiceBadge';
import { QRDisplay } from '../components/QRDisplay';
import { PlateBadge } from '../components/PlateBadge';
import { CarAvatar } from '../components/CarAvatar';
import { PlateInput } from '../components/PlateInput';
import { PostventaServicesTable, newPostventaRow } from '../components/PostventaServicesTable';
import { AppointmentConfirmDialog } from '../components/AppointmentConfirmDialog';
import { CAR_BRANDS, CAR_MODELS, formatCurrency, isHoliday, COLOMBIA_HOLIDAYS } from '../lib/utils';
import { toast } from 'sonner';
import { Plus, Calendar as CalendarIcon, Clock, User, Car, DollarSign, QrCode, CheckCircle, ArrowRight, AlertCircle, Users, Package, Trash2, PlusCircle, MessageCircle, Mail, Send, UserCog, CalendarClock, Lock } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { PostventaBadge } from '../components/PostventaBadge';

const APPOINTMENT_TYPE_LABELS = { franja: 'Por franja', prioridad: 'Por prioridad', postventa: 'Postventa' };

export const Appointments = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [dialogOpen, setDialogOpen] = useState(false);
    const [serviceCatalog, setServiceCatalog] = useState({});
    const [createdOrder, setCreatedOrder] = useState(null);
    const [showQRDialog, setShowQRDialog] = useState(false);
    const [slotsAvailability, setSlotsAvailability] = useState(null);
    const [loadingSlots, setLoadingSlots] = useState(false);
    
    // Notification email (editable in QR dialog)
    const [notificationEmail, setNotificationEmail] = useState('');
    
    // Services with individual prices
    const [selectedServices, setSelectedServices] = useState([]);
    // Servicios de una cita de postventa (tabla editable, el valor puede ser 0)
    const [postventaServices, setPostventaServices] = useState([]);
    
    // Custom service input
    const [customServiceName, setCustomServiceName] = useState('');
    const [customServicePrice, setCustomServicePrice] = useState('');
    
    // Autocomplete states
    const [brandSuggestions, setBrandSuggestions] = useState([]);
    const [modelSuggestions, setModelSuggestions] = useState([]);
    const [showBrandSuggestions, setShowBrandSuggestions] = useState(false);
    const [showModelSuggestions, setShowModelSuggestions] = useState(false);
    const brandInputRef = useRef(null);
    const modelInputRef = useRef(null);
    
    const [formData, setFormData] = useState({
        client_name: '',
        client_phone: '',
        client_email: '',
        client_cedula: '',
        plate: '',
        brand: '',
        model: '',
        time_slot: '',
        notes: '',
        confirmation_pin: '',
        appointment_type: 'franja', // 'franja' | 'prioridad' | 'postventa'
        authorization_code: '',
        priority_reason: '',
        discount_code: '',
        postventa_code: '',
        postventa_motivo: '',
        original_order_id: '',
    });
    // Confirmación final con reloj de 60 s
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    // Placa o documento ya registrados: { source: 'plate' | 'document', value, data }
    const [existingMatch, setExistingMatch] = useState(null);
    const askedLookupsRef = useRef(new Set());
    // Estado del código de descuento validado
    const [discountApplied, setDiscountApplied] = useState(null); // { code, discount_type, discount_value, discount_amount, new_total }
    const [validatingDiscount, setValidatingDiscount] = useState(false);

    // Fetch service catalog on mount
    useEffect(() => {
        const fetchCatalog = async () => {
            try {
                const response = await servicesAPI.getCatalog();
                setServiceCatalog(response.data);
            } catch (error) {
                console.error('Error fetching catalog:', error);
            }
        };
        fetchCatalog();
    }, []);

    // Fetch slot availability when date changes
    const fetchSlotsAvailability = useCallback(async (date) => {
        try {
            setLoadingSlots(true);
            const dateStr = format(date, 'yyyy-MM-dd');
            const response = await slotsAPI.getAvailability(dateStr);
            setSlotsAvailability(response.data);
        } catch (error) {
            console.error('Error fetching slots:', error);
            setSlotsAvailability(null);
        } finally {
            setLoadingSlots(false);
        }
    }, []);

    const fetchOrders = useCallback(async (date) => {
        try {
            setLoading(true);
            const dateStr = format(date, 'yyyy-MM-dd');
            const response = await ordersAPI.getAll({ date: dateStr });
            setOrders(response.data);
        } catch (error) {
            console.error('Error fetching orders:', error);
            toast.error('Error al cargar las citas');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchOrders(selectedDate);
        fetchSlotsAvailability(selectedDate);
    }, [selectedDate, fetchOrders, fetchSlotsAvailability]);

    // Calculate total from selected services
    const calculateTotal = () => {
        if (formData.appointment_type === 'postventa') {
            return postventaServices.reduce((sum, row) => sum + (row.no_charge ? 0 : (parseFloat(row.price) || 0)), 0);
        }
        return selectedServices.reduce((sum, svc) => {
            const base = svc.price || 0;
            const sunroofExtra = (svc.parts || []).includes('sunroof') ? (parseFloat(svc.sunroof_price) || 0) : 0;
            return sum + base + sunroofExtra;
        }, 0);
    };

    const handleDateSelect = (date) => {
        if (date) {
            if (date.getDay() === 0) {
                toast.error('Los domingos no hay servicio');
                return;
            }
            if (isHoliday(date)) {
                toast.error('Este día es festivo en Colombia');
                return;
            }
            setSelectedDate(date);
            setFormData(prev => ({ ...prev, time_slot: '' }));
        }
    };

    // Autocomplete handlers for brand
    const handleBrandInputChange = (value) => {
        setFormData(prev => ({ ...prev, brand: value, model: '' }));
        if (value.length > 0) {
            const filtered = CAR_BRANDS.filter(brand => 
                brand.toLowerCase().includes(value.toLowerCase())
            );
            setBrandSuggestions(filtered);
            setShowBrandSuggestions(filtered.length > 0);
        } else {
            setBrandSuggestions([]);
            setShowBrandSuggestions(false);
        }
    };

    const handleBrandSelect = (brand) => {
        setFormData(prev => ({ ...prev, brand, model: '' }));
        setShowBrandSuggestions(false);
    };

    // Autocomplete handlers for model
    const handleModelInputChange = (value) => {
        setFormData(prev => ({ ...prev, model: value }));
        const models = CAR_MODELS[formData.brand] || [];
        if (value.length > 0 && models.length > 0) {
            const filtered = models.filter(model => 
                model.toLowerCase().includes(value.toLowerCase())
            );
            setModelSuggestions(filtered);
            setShowModelSuggestions(filtered.length > 0);
        } else if (value.length === 0 && models.length > 0) {
            setModelSuggestions(models);
            setShowModelSuggestions(true);
        } else {
            setModelSuggestions([]);
            setShowModelSuggestions(false);
        }
    };

    const handleModelSelect = (model) => {
        setFormData(prev => ({ ...prev, model }));
        setShowModelSuggestions(false);
    };

    const handleTimeSlotChange = (value) => {
        setFormData(prev => ({ ...prev, time_slot: value }));
    };

    // Servicios que requieren selección de vidrios/partes
    const SERVICES_WITH_PARTS = [
        'nanooptik', 'black_ceramic_autobahn', 'ultraoptik_aswf', 
        'ceramic_i3_autobahn', 'ceramic_i3_plus_autobahn', 'huperoptik'
    ];
    
    // Partes del vehículo disponibles para polarizado
    const VEHICLE_PARTS = [
        { id: 'panoramico', name: 'Panorámico' },
        { id: 'vidrio_copiloto', name: 'Vidrio Copiloto' },
        { id: 'vidrio_piloto', name: 'Vidrio Piloto' },
        { id: 'vidrio_trasero_piloto', name: 'Vidrio Trasero Piloto' },
        { id: 'vidrio_trasero_copiloto', name: 'Vidrio Trasero Copiloto' },
        { id: 'trasero', name: 'Trasero' },
        { id: 'luneta', name: 'Luneta' },
        { id: 'sunroof', name: 'Sunroof' },
        { id: 'custodias', name: 'Custodias' },
    ];

    // Check if service requires parts selection
    const serviceRequiresParts = (serviceId) => {
        return SERVICES_WITH_PARTS.includes(serviceId);
    };

    // Toggle service selection
    const handleServiceToggle = (serviceId, serviceName, categoryName) => {
        setSelectedServices(prev => {
            const exists = prev.find(s => s.serviceId === serviceId);
            if (exists) {
                return prev.filter(s => s.serviceId !== serviceId);
            } else {
                return [...prev, { 
                    serviceId, 
                    serviceName, 
                    category: categoryName, 
                    price: 0,
                    parts: serviceRequiresParts(serviceId) ? [] : undefined
                }];
            }
        });
    };

    // Update service price
    const handleServicePriceChange = (serviceId, price) => {
        setSelectedServices(prev => 
            prev.map(s => s.serviceId === serviceId ? { ...s, price: parseFloat(price) || 0 } : s)
        );
    };

    // Toggle vehicle part for a service
    const handlePartToggle = (serviceId, partId) => {
        setSelectedServices(prev => 
            prev.map(s => {
                if (s.serviceId === serviceId) {
                    const currentParts = s.parts || [];
                    const partExists = currentParts.includes(partId);
                    return {
                        ...s,
                        parts: partExists 
                            ? currentParts.filter(p => p !== partId)
                            : [...currentParts, partId]
                    };
                }
                return s;
            })
        );
    };

    // Select ALL parts for a service (Ultrasecure "Completo")
    const handleSelectAllParts = (serviceId) => {
        setSelectedServices(prev =>
            prev.map(s => {
                if (s.serviceId !== serviceId) return s;
                const allIds = VEHICLE_PARTS.map(p => p.id);
                const isAll = (s.parts || []).length === allIds.length;
                return { ...s, parts: isAll ? [] : allIds };
            })
        );
    };

    // Set custom Sunroof extra price for a service
    const handleSunroofPriceChange = (serviceId, price) => {
        setSelectedServices(prev =>
            prev.map(s => s.serviceId === serviceId ? { ...s, sunroof_price: price } : s)
        );
    };

    // Add custom service
    const handleAddCustomService = () => {
        if (!customServiceName.trim()) {
            toast.error('Ingresa el nombre del servicio o producto');
            return;
        }
        if (!customServicePrice || parseFloat(customServicePrice) <= 0) {
            toast.error('Ingresa el valor del servicio o producto');
            return;
        }
        
        const customId = `custom_${Date.now()}`;
        setSelectedServices(prev => [...prev, {
            serviceId: customId,
            serviceName: customServiceName.trim(),
            category: 'Personalizado',
            price: parseFloat(customServicePrice),
            isCustom: true
        }]);
        setCustomServiceName('');
        setCustomServicePrice('');
        toast.success('Servicio agregado');
    };

    // Remove service
    const handleRemoveService = (serviceId) => {
        setSelectedServices(prev => prev.filter(s => s.serviceId !== serviceId));
    };

    // ============================================================
    // REASIGNAR CITA (posponer / adelantar con password)
    // ============================================================
    const [rescheduleOrder, setRescheduleOrder] = useState(null);
    const [rsDate, setRsDate] = useState(new Date());
    const [rsSlot, setRsSlot] = useState('');
    const [rsPassword, setRsPassword] = useState('');
    const [rsReason, setRsReason] = useState('');
    const [rsLoading, setRsLoading] = useState(false);
    const [rsSlotsAvailability, setRsSlotsAvailability] = useState(null);

    const openReschedule = async (order) => {
        setRescheduleOrder(order);
        setRsDate(order.date ? new Date(order.date + 'T00:00:00') : new Date());
        setRsSlot(order.time_slot || '');
        setRsPassword('');
        setRsReason('');
        // Cargar disponibilidad para la fecha actual de la orden
        try {
            const res = await slotsAPI.getAvailability(order.date || format(new Date(), 'yyyy-MM-dd'));
            setRsSlotsAvailability(res.data);
        } catch (e) {
            setRsSlotsAvailability(null);
        }
    };

    const closeReschedule = () => setRescheduleOrder(null);

    const handleRsDateChange = async (newDate) => {
        if (!newDate) return;
        setRsDate(newDate);
        setRsSlot('');
        try {
            const res = await slotsAPI.getAvailability(format(newDate, 'yyyy-MM-dd'));
            setRsSlotsAvailability(res.data);
        } catch (e) {
            setRsSlotsAvailability(null);
        }
    };

    const submitReschedule = async () => {
        if (!rsSlot) {
            toast.error('Selecciona una nueva franja');
            return;
        }
        if (!rsPassword.trim()) {
            toast.error('Ingresa la contraseña de autorización');
            return;
        }
        setRsLoading(true);
        try {
            const res = await paymentsAPI.reschedule(rescheduleOrder.id, {
                new_date: format(rsDate, 'yyyy-MM-dd'),
                new_time_slot: rsSlot,
                password: rsPassword.trim(),
                reason: rsReason || null,
            });
            toast.success(
                res.data.email_sent
                    ? `Cita reagendada a ${res.data.new_date} ${res.data.new_time} · Correo enviado`
                    : `Cita reagendada a ${res.data.new_date} ${res.data.new_time}`
            );
            closeReschedule();
            fetchOrders();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error al reagendar');
        } finally {
            setRsLoading(false);
        }
    };

    const resetForm = () => {
        setFormData({
            client_name: '',
            client_phone: '',
            client_email: '',
            client_cedula: '',
            plate: '',
            brand: '',
            model: '',
            time_slot: '',
            notes: '',
            confirmation_pin: '',
            appointment_type: 'franja',
            authorization_code: '',
            priority_reason: '',
            discount_code: '',
            postventa_code: '',
            postventa_motivo: '',
            original_order_id: '',
        });
        askedLookupsRef.current = new Set();
        setExistingMatch(null);
        setSelectedServices([]);
        setPostventaServices([]);
        setCustomServiceName('');
        setCustomServicePrice('');
        setBrandSuggestions([]);
        setModelSuggestions([]);
        setDiscountApplied(null);
    };

    // Validar código de descuento sobre el subtotal actual
    const handleValidateDiscount = async () => {
        const code = (formData.discount_code || '').trim();
        if (!code) {
            toast.error('Ingresa un código de descuento');
            return;
        }
        const subtotal = calculateTotal();
        if (subtotal <= 0) {
            toast.error('Agrega al menos un servicio antes de validar el código');
            return;
        }
        setValidatingDiscount(true);
        try {
            const res = await discountCodesAPI.validate(code, subtotal);
            setDiscountApplied(res.data);
            toast.success(`Código ${res.data.code} aplicado: -${formatCurrency(res.data.discount_amount)}`);
        } catch (e) {
            setDiscountApplied(null);
            toast.error(e.response?.data?.detail || 'Código inválido');
        } finally {
            setValidatingDiscount(false);
        }
    };

    const handleRemoveDiscount = () => {
        setDiscountApplied(null);
        setFormData(prev => ({ ...prev, discount_code: '' }));
    };

    // Detecta si la placa o el documento ya tienen órdenes registradas
    const checkExisting = useCallback(async (source, value) => {
        const key = `${source}:${value}`;
        if (askedLookupsRef.current.has(key)) return;
        askedLookupsRef.current.add(key);
        try {
            const res = await ordersAPI.lookupExisting(source === 'plate' ? { plate: value } : { document: value });
            const data = res.data?.[source];
            if (data) setExistingMatch({ source, value, data });
        } catch (error) {
            askedLookupsRef.current.delete(key);
            console.error('Error looking up existing client:', error);
        }
    }, []);

    useEffect(() => {
        if (!dialogOpen || formData.plate.length !== 6) return;
        checkExisting('plate', formData.plate);
    }, [dialogOpen, formData.plate, checkExisting]);

    useEffect(() => {
        const doc = formData.client_cedula.trim();
        if (!dialogOpen || doc.length < 5) return undefined;
        const timer = setTimeout(() => checkExisting('document', doc), 700);
        return () => clearTimeout(timer);
    }, [dialogOpen, formData.client_cedula, checkExisting]);

    const applyExistingMatch = (asPostventa) => {
        if (!existingMatch) return;
        const cd = existingMatch.data.client_data || {};
        // Evita volver a preguntar por el mismo cliente al llenar el otro campo
        if (cd.plate) askedLookupsRef.current.add(`plate:${cd.plate}`);
        if (cd.client_cedula) askedLookupsRef.current.add(`document:${cd.client_cedula}`);
        setFormData(prev => ({
            ...prev,
            client_name: prev.client_name || cd.client_name || '',
            client_phone: prev.client_phone || cd.client_phone || '',
            client_email: prev.client_email || cd.client_email || '',
            client_cedula: prev.client_cedula || cd.client_cedula || '',
            ...(existingMatch.source === 'plate'
                ? { brand: prev.brand || cd.brand || '', model: prev.model || cd.model || '' }
                : {}),
            ...(asPostventa
                ? { appointment_type: 'postventa', original_order_id: existingMatch.data.last_order?.id || '' }
                : {}),
        }));
        setExistingMatch(null);
    };

    // Al elegir Postventa la tabla arranca con una fila lista para llenar
    useEffect(() => {
        if (formData.appointment_type === 'postventa' && postventaServices.length === 0) {
            setPostventaServices([newPostventaRow()]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [formData.appointment_type]);

    const buildServicesData = () => {
        if (formData.appointment_type === 'postventa') {
            const catalogServices = Object.values(serviceCatalog).flatMap(cat => cat.services || []);
            const rows = postventaServices.filter(row => row.name.trim());
            if (rows.length === 0) {
                return [{ service: 'postventa', description: `Postventa - ${formData.postventa_motivo.trim()}`, price: 0 }];
            }
            return rows.map(row => {
                const name = row.name.trim();
                const match = catalogServices.find(s => s.name.toLowerCase() === name.toLowerCase());
                return {
                    service: match ? match.id : 'postventa',
                    description: `Postventa - ${name}`,
                    price: row.no_charge ? 0 : (parseFloat(row.price) || 0),
                    no_charge: !!row.no_charge,
                };
            });
        }
        const servicesData = selectedServices.map(svc => {
            const parts = svc.parts || [];
            const sunroofPrice = parts.includes('sunroof') ? (parseFloat(svc.sunroof_price) || 0) : 0;
            return {
                service: svc.serviceId,
                price: svc.price,
                description: `${svc.category} - ${svc.serviceName}`,
                parts,
                extras: sunroofPrice > 0
                    ? [{ id: 'sunroof', nombre: 'Sunroof (adicional)', price: sunroofPrice }]
                    : [],
            };
        });
        if (servicesData.length === 0 && formData.appointment_type === 'postventa') {
            return [{ service: 'postventa', description: `Postventa - ${formData.postventa_motivo.trim()}`, price: 0 }];
        }
        return servicesData;
    };

    // Paso 1: validar y abrir el modal de confirmación
    const handleSubmit = (e) => {
        e.preventDefault();
        const type = formData.appointment_type;
        const isPriority = type === 'prioridad';
        const isPostventa = type === 'postventa';

        if (formData.plate.length !== 6) {
            toast.error('La placa debe tener 6 caracteres (solo letras y números)');
            return;
        }
        if (!formData.brand.trim() || !formData.model.trim()) {
            toast.error('Ingresa la marca y el modelo del vehículo');
            return;
        }
        if (!isPostventa && selectedServices.length === 0) {
            toast.error('Selecciona al menos un servicio');
            return;
        }

        if (!isPriority) {
            if (!formData.time_slot) {
                toast.error('Selecciona una franja horaria');
                return;
            }
            const selectedSlot = slotsAvailability?.slots?.find(s => s.id === formData.time_slot);
            if (selectedSlot && selectedSlot.remaining <= 0) {
                toast.error('Esta franja ya no tiene cupos disponibles');
                return;
            }
        }

        if (!isPostventa && calculateTotal() <= 0) {
            toast.error('Ingresa el valor de al menos un servicio');
            return;
        }

        if (isPriority) {
            if (!formData.authorization_code || formData.authorization_code.trim() === '') {
                toast.error('Ingresa el código de autorización para citas por prioridad');
                return;
            }
        } else if (isPostventa) {
            if (postventaServices.some(row => !row.name.trim())) {
                toast.error('Escribe el nombre de cada servicio de postventa o quita la fila vacía');
                return;
            }
            if (postventaServices.some(row => (parseFloat(row.price) || 0) < 0)) {
                toast.error('El valor de los servicios no puede ser negativo');
                return;
            }
            if (!formData.postventa_motivo.trim()) {
                toast.error('Describe el motivo de la postventa');
                return;
            }
            if (!formData.postventa_code.trim()) {
                toast.error('Ingresa la contraseña de postventa');
                return;
            }
        } else if (!formData.confirmation_pin || formData.confirmation_pin.trim() === '') {
            toast.error('Ingresa el PIN de confirmación para agendar');
            return;
        }

        setConfirmOpen(true);
    };

    // Paso 2: el usuario confirmó dentro de los 60 s
    const createAppointment = async () => {
        const isPriority = formData.appointment_type === 'prioridad';
        const isPostventa = formData.appointment_type === 'postventa';
        const total = calculateTotal();
        setSubmitting(true);
        try {
            const submitData = {
                client_name: formData.client_name,
                client_phone: formData.client_phone,
                client_email: formData.client_email || null,
                client_cedula: formData.client_cedula || null,
                plate: formData.plate,
                brand: formData.brand,
                model: formData.model,
                year: null,
                color: null,
                date: format(selectedDate, 'yyyy-MM-dd'),
                time_slot: isPriority ? 'prioridad' : formData.time_slot,
                services: buildServicesData(),
                negotiated_value: total,
                notes: formData.notes || (isPostventa ? formData.postventa_motivo.trim() : null),
                confirmation_pin: isPriority || isPostventa ? null : formData.confirmation_pin.trim(),
                is_priority: isPriority,
                authorization_code: isPriority
                    ? formData.authorization_code.trim()
                    : isPostventa ? formData.postventa_code.trim() : null,
                priority_reason: isPriority ? (formData.priority_reason || null) : null,
                discount_code: discountApplied ? discountApplied.code : null,
                is_postventa: isPostventa,
                postventa_type: isPostventa ? 'postventa' : null,
                postventa_motivo: isPostventa ? formData.postventa_motivo.trim() : null,
                original_order_id: isPostventa ? (formData.original_order_id || null) : null,
            };

            const response = await ordersAPI.create(submitData);
            setConfirmOpen(false);
            setCreatedOrder(response.data);
            setNotificationEmail(response.data.client_email || ''); // Set email for notification
            setDialogOpen(false);
            setShowQRDialog(true);
            fetchOrders(selectedDate);
            fetchSlotsAvailability(selectedDate);
            resetForm();
        } catch (error) {
            setConfirmOpen(false);
            toast.error(error.response?.data?.detail || 'Error al agendar cita');
        } finally {
            setSubmitting(false);
        }
    };

    const confirmSections = () => {
        const type = formData.appointment_type;
        const total = discountApplied ? discountApplied.new_total : calculateTotal();
        return [
            {
                title: 'Cita',
                rows: [
                    { label: 'Tipo', value: APPOINTMENT_TYPE_LABELS[type], highlight: true },
                    { label: 'Fecha', value: format(selectedDate, "EEEE d 'de' MMMM yyyy", { locale: es }) },
                    { label: 'Franja', value: type === 'prioridad' ? 'Prioridad (inmediata)' : getSlotDisplayName(formData.time_slot) },
                    { label: 'Motivo de prioridad', value: type === 'prioridad' ? formData.priority_reason : null },
                    { label: 'Motivo de postventa', value: type === 'postventa' ? formData.postventa_motivo : null },
                    { label: 'Notas', value: formData.notes },
                ],
            },
            {
                title: 'Cliente',
                rows: [
                    { label: 'Nombre', value: formData.client_name },
                    { label: 'Teléfono', value: formData.client_phone },
                    { label: 'Email', value: formData.client_email },
                    { label: 'Cédula/Documento', value: formData.client_cedula },
                ],
            },
            {
                title: 'Vehículo',
                rows: [
                    { label: 'Placa', value: <PlateBadge plate={formData.plate} size="md" /> },
                    { label: 'Marca', value: formData.brand },
                    { label: 'Modelo', value: formData.model },
                ],
            },
            {
                title: 'Servicios',
                rows: [
                    ...(type === 'postventa'
                        ? buildServicesData().map(svc => ({ label: svc.description.replace(/^Postventa - /, ''), value: svc.no_charge ? 'Sin pago' : formatCurrency(svc.price) }))
                        : selectedServices.map(svc => {
                            const sunroof = (svc.parts || []).includes('sunroof') ? (parseFloat(svc.sunroof_price) || 0) : 0;
                            return { label: svc.serviceName, value: formatCurrency((svc.price || 0) + sunroof) };
                        })),
                    { label: `Descuento ${discountApplied?.code || ''}`, value: discountApplied ? `-${formatCurrency(discountApplied.discount_amount)}` : null },
                    { label: 'Total', value: formatCurrency(total), highlight: true },
                ],
            },
        ];
    };

    const handleCloseQRDialog = () => {
        setShowQRDialog(false);
        setCreatedOrder(null);
    };

    const disabledDays = (date) => {
        // Obtener la fecha de hoy sin hora (solo año, mes, día)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Crear copia de la fecha para comparar sin hora
        const compareDate = new Date(date);
        compareDate.setHours(0, 0, 0, 0);
        
        // Deshabilitar: fechas pasadas, domingos y festivos de Colombia
        return compareDate < today || date.getDay() === 0 || isHoliday(date);
    };

    // Verificar si una franja horaria está disponible según la hora actual
    const isSlotAvailableByTime = (slot) => {
        const today = new Date();
        const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
        const todayStr = format(today, 'yyyy-MM-dd');
        
        // Si no es hoy, todas las franjas están disponibles (respetando capacidad)
        if (selectedDateStr !== todayStr) {
            return true;
        }
        
        // Si es hoy, verificar que la franja no haya terminado
        // Obtener hora actual en Colombia (UTC-5)
        const nowUTC = new Date();
        const colombiaOffset = -5; // UTC-5
        const colombiaTime = new Date(nowUTC.getTime() + (colombiaOffset * 60 * 60 * 1000));
        
        const currentHour = colombiaTime.getUTCHours();
        const currentMinute = colombiaTime.getUTCMinutes();
        const currentTimeInMinutes = currentHour * 60 + currentMinute;
        
        // Parsear hora de FIN del slot (formato "HH:MM")
        const [slotEndHour, slotEndMinute] = slot.end.split(':').map(Number);
        const slotEndInMinutes = slotEndHour * 60 + slotEndMinute;
        
        // La franja está disponible si aún no ha terminado (hora actual < hora fin)
        return currentTimeInMinutes < slotEndInMinutes;
    };

    const getSlotDisplayName = (slotId) => {
        const slot = slotsAvailability?.slots?.find(s => s.id === slotId);
        if (slot) {
            return `${slot.name} (${slot.start} - ${slot.end})`;
        }
        return slotId;
    };

    // Defensive slot bucketing: matches legacy time_slot values like "08-12",
    // "8:00 AM - 10:00 AM", "08:00 - 09:00" to the current franja_X ids.
    const slotIdForOrder = (order, slots) => {
        if (!slots || !slots.length) return null;
        if (slots.some(s => s.id === order.time_slot)) return order.time_slot;
        let hour = null;
        if (order.scheduled_time) {
            const [h] = String(order.scheduled_time).split(':');
            hour = parseInt(h, 10);
        } else if (order.time_slot) {
            const m = String(order.time_slot).match(/(\d{1,2})/);
            if (m) hour = parseInt(m[1], 10);
        }
        if (hour == null || Number.isNaN(hour)) return slots[0]?.id || null;
        const mins = hour * 60;
        for (const s of slots) {
            const [sh, sm] = s.start.split(':').map(Number);
            const [eh, em] = s.end.split(':').map(Number);
            const startM = sh * 60 + sm;
            const endM = eh * 60 + em;
            if (mins >= startM && mins < endM) return s.id;
        }
        // Fallback: bucket by closest start
        return slots[0].id;
    };

    const ordersBySlot = slotsAvailability?.slots?.reduce((acc, slot) => {
        acc[slot.id] = orders.filter(o => slotIdForOrder(o, slotsAvailability.slots) === slot.id);
        return acc;
    }, {}) || {};

    return (
        <div className="space-y-6" data-testid="appointments-page">
            {/* QR Dialog */}
            <Dialog open={showQRDialog} onOpenChange={setShowQRDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-xl flex items-center gap-2">
                            <CheckCircle className="w-6 h-6 text-green-500" />
                            ¡Cita Agendada!
                        </DialogTitle>
                    </DialogHeader>
                    {createdOrder && (
                        <div className="space-y-4">
                            <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                                <div className="flex items-center gap-2">
                                    <User className="w-4 h-4 text-muted-foreground" />
                                    <span className="font-medium">{createdOrder.client_name}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Car className="w-4 h-4 text-muted-foreground" />
                                    <PlateBadge plate={createdOrder.plate} size="md" />
                                    <span className="text-muted-foreground">
                                        - {createdOrder.brand} {createdOrder.model}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-muted-foreground" />
                                    <span>{createdOrder.date} • {getSlotDisplayName(createdOrder.time_slot)}</span>
                                </div>
                            </div>

                            {/* Hora específica de la cita */}
                            {createdOrder.scheduled_time && (
                                <div className="p-4 rounded-lg bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/40 text-center">
                                    <p className="text-sm text-muted-foreground">Hora de su cita:</p>
                                    <p className="text-3xl font-mono font-bold text-cyan-400">
                                        {createdOrder.scheduled_time}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        El check-in estará disponible a partir de esta hora
                                    </p>
                                </div>
                            )}

                            <QRDisplay 
                                qrCode={createdOrder.qr_code}
                                orderCode={createdOrder.order_code}
                                clientName={createdOrder.client_name}
                            />

                            {/* Notification Buttons */}
                            <div className="p-4 rounded-lg border border-dashed border-muted-foreground/50 space-y-3">
                                <p className="text-sm font-medium flex items-center gap-2">
                                    <Send className="w-4 h-4" />
                                    Enviar confirmación al cliente:
                                </p>
                                
                                {/* Editable Email Field */}
                                <div className="flex gap-2 items-center">
                                    <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                    <Input
                                        type="email"
                                        value={notificationEmail}
                                        onChange={(e) => setNotificationEmail(e.target.value)}
                                        placeholder="correo@ejemplo.com"
                                        className="flex-1 h-9 text-sm"
                                        data-testid="notification-email-input"
                                    />
                                </div>
                                
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        className="flex-1 bg-green-500/10 border-green-500/30 hover:bg-green-500/20 text-green-500"
                                        onClick={async () => {
                                            try {
                                                const res = await notificationsAPI.getWhatsAppUrl(createdOrder.id);
                                                window.open(res.data.url, '_blank');
                                                toast.success('Abriendo WhatsApp...');
                                            } catch (error) {
                                                toast.error('Error al generar enlace de WhatsApp');
                                            }
                                        }}
                                        data-testid="send-whatsapp-btn"
                                    >
                                        <MessageCircle className="w-4 h-4 mr-2" />
                                        WhatsApp
                                    </Button>
                                    <Button
                                        variant="outline"
                                        className="flex-1 bg-blue-500/10 border-blue-500/30 hover:bg-blue-500/20 text-blue-500"
                                        onClick={async () => {
                                            if (!notificationEmail) {
                                                toast.error('Ingresa un correo electrónico');
                                                return;
                                            }
                                            try {
                                                const res = await notificationsAPI.send({
                                                    order_id: createdOrder.id,
                                                    send_email: true,
                                                    email: notificationEmail
                                                });
                                                if (res.data.results?.email?.success) {
                                                    toast.success(`Correo enviado a ${notificationEmail}`);
                                                } else {
                                                    toast.error(res.data.results?.email?.error || 'Error al enviar correo');
                                                }
                                            } catch (error) {
                                                toast.error('Error al enviar correo electrónico');
                                            }
                                        }}
                                        data-testid="send-email-btn"
                                    >
                                        <Mail className="w-4 h-4 mr-2" />
                                        Email
                                    </Button>
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <Button variant="outline" onClick={handleCloseQRDialog} className="flex-1">
                                    Cerrar
                                </Button>
                                <Button 
                                    onClick={() => {
                                        handleCloseQRDialog();
                                        window.location.href = '/checkin';
                                    }}
                                    className="flex-1 brand-glow"
                                >
                                    Ir a Check-in
                                    <ArrowRight className="w-4 h-4 ml-2" />
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl">Agendamiento</h1>
                    <p className="text-muted-foreground">Gestiona las citas del taller</p>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                        <Button className="brand-glow touch-target" data-testid="new-appointment-btn">
                            <Plus className="w-4 h-4 mr-2" />
                            Nueva Cita
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle className="font-heading text-xl">Agendar Nueva Cita</DialogTitle>
                            <DialogDescription>Complete los datos del cliente, vehículo y servicios</DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-6">
                            {/* Tipo de Cita */}
                            <div className="space-y-2 p-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5">
                                <Label className="flex items-center gap-2 text-cyan-400">
                                    <Clock className="w-4 h-4" />
                                    Tipo de Cita *
                                </Label>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setFormData(prev => ({ ...prev, appointment_type: 'franja' }))}
                                        className={`p-3 rounded-lg border text-left transition-all ${
                                            formData.appointment_type === 'franja'
                                                ? 'border-cyan-500 bg-cyan-500/10'
                                                : 'border-border bg-card hover:border-cyan-500/50'
                                        }`}
                                        data-testid="appointment-type-franja"
                                    >
                                        <p className="font-medium">Por franja</p>
                                        <p className="text-xs text-muted-foreground">Respeta cupos y horarios</p>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setFormData(prev => ({ ...prev, appointment_type: 'prioridad' }))}
                                        className={`p-3 rounded-lg border text-left transition-all ${
                                            formData.appointment_type === 'prioridad'
                                                ? 'border-amber-500 bg-amber-500/10'
                                                : 'border-border bg-card hover:border-amber-500/50'
                                        }`}
                                        data-testid="appointment-type-prioridad"
                                    >
                                        <p className="font-medium">Por prioridad</p>
                                        <p className="text-xs text-muted-foreground">Sin franja · requiere código</p>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setFormData(prev => ({ ...prev, appointment_type: 'postventa' }))}
                                        className={`p-3 rounded-lg border text-left transition-all ${
                                            formData.appointment_type === 'postventa'
                                                ? 'border-emerald-500 bg-emerald-500/10'
                                                : 'border-border bg-card hover:border-emerald-500/50'
                                        }`}
                                        data-testid="appointment-type-postventa"
                                    >
                                        <p className="font-medium">Postventa</p>
                                        <p className="text-xs text-muted-foreground">Cliente existente · requiere contraseña</p>
                                    </button>
                                </div>
                            </div>

                            {/* Client Info */}
                            <div className="space-y-4">
                                <h3 className="font-heading text-lg flex items-center gap-2">
                                    <User className="w-4 h-4" />
                                    Datos del Cliente
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="client_name">Nombre *</Label>
                                        <Input
                                            id="client_name"
                                            value={formData.client_name}
                                            onChange={(e) => setFormData(prev => ({ ...prev, client_name: e.target.value }))}
                                            required
                                            data-testid="appointment-client-name"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="client_phone">Teléfono *</Label>
                                        <Input
                                            id="client_phone"
                                            value={formData.client_phone}
                                            onChange={(e) => setFormData(prev => ({ ...prev, client_phone: e.target.value }))}
                                            required
                                            data-testid="appointment-client-phone"
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="client_email">Email</Label>
                                        <Input
                                            id="client_email"
                                            type="email"
                                            value={formData.client_email}
                                            onChange={(e) => setFormData(prev => ({ ...prev, client_email: e.target.value }))}
                                            data-testid="appointment-client-email"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="client_cedula">Cédula/Documento</Label>
                                        <Input
                                            id="client_cedula"
                                            value={formData.client_cedula}
                                            onChange={(e) => setFormData(prev => ({ ...prev, client_cedula: e.target.value }))}
                                            data-testid="appointment-client-cedula"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Vehicle Info */}
                            <div className="space-y-4">
                                <h3 className="font-heading text-lg flex items-center gap-2">
                                    <Car className="w-4 h-4" />
                                    Datos del Vehículo
                                </h3>
                                <div className="space-y-2">
                                    <Label>
                                        Placa * <span className="text-xs text-muted-foreground font-normal">(6 caracteres, solo letras y números)</span>
                                    </Label>
                                    <PlateInput
                                        value={formData.plate}
                                        onChange={(plate) => setFormData(prev => ({ ...prev, plate }))}
                                        testId="appointment-plate"
                                    />
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2 relative">
                                        <Label>Marca *</Label>
                                        <Input
                                            ref={brandInputRef}
                                            value={formData.brand}
                                            onChange={(e) => handleBrandInputChange(e.target.value)}
                                            onFocus={() => {
                                                if (formData.brand.length > 0) {
                                                    const filtered = CAR_BRANDS.filter(b => 
                                                        b.toLowerCase().includes(formData.brand.toLowerCase())
                                                    );
                                                    setBrandSuggestions(filtered);
                                                    setShowBrandSuggestions(filtered.length > 0);
                                                }
                                            }}
                                            onBlur={() => setTimeout(() => setShowBrandSuggestions(false), 200)}
                                            placeholder="Escriba la marca..."
                                            data-testid="appointment-brand"
                                            autoComplete="off"
                                        />
                                        {showBrandSuggestions && brandSuggestions.length > 0 && (
                                            <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-48 overflow-auto">
                                                {brandSuggestions.map((brand) => (
                                                    <div
                                                        key={brand}
                                                        className="px-3 py-2 cursor-pointer hover:bg-muted transition-colors text-sm"
                                                        onMouseDown={() => handleBrandSelect(brand)}
                                                    >
                                                        {brand}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                <div className="space-y-2 relative">
                                    <Label>Modelo *</Label>
                                    <Input
                                        ref={modelInputRef}
                                        value={formData.model}
                                        onChange={(e) => handleModelInputChange(e.target.value)}
                                        onFocus={() => {
                                            const models = CAR_MODELS[formData.brand] || [];
                                            if (models.length > 0) {
                                                setModelSuggestions(models);
                                                setShowModelSuggestions(true);
                                            }
                                        }}
                                        onBlur={() => setTimeout(() => setShowModelSuggestions(false), 200)}
                                        placeholder={formData.brand ? "Escriba el modelo..." : "Primero ingrese la marca"}
                                        disabled={!formData.brand}
                                        data-testid="appointment-model"
                                        autoComplete="off"
                                    />
                                    {showModelSuggestions && modelSuggestions.length > 0 && (
                                        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-48 overflow-auto">
                                            {modelSuggestions.map((model) => (
                                                <div
                                                    key={model}
                                                    className="px-3 py-2 cursor-pointer hover:bg-muted transition-colors text-sm"
                                                    onMouseDown={() => handleModelSelect(model)}
                                                >
                                                    {model}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                </div>
                            </div>

                            {/* Date & Time Slot */}
                            <div className="space-y-4">
                                <h3 className="font-heading text-lg flex items-center gap-2">
                                    <CalendarIcon className="w-4 h-4" />
                                    {formData.appointment_type === 'prioridad' ? 'Fecha (Prioridad)' : 'Fecha y Franja Horaria'}
                                </h3>
                                <div className={`grid grid-cols-1 ${formData.appointment_type !== 'prioridad' ? 'md:grid-cols-2' : ''} gap-4`}>
                                    <div className="space-y-2">
                                        <Label>Fecha de la Cita *</Label>
                                        <div className="flex justify-center border rounded-lg p-2 overflow-x-auto">
                                            <Calendar
                                                mode="single"
                                                selected={selectedDate}
                                                onSelect={handleDateSelect}
                                                locale={es}
                                                disabled={disabledDays}
                                                className="rounded-md"
                                            />
                                        </div>
                                        <p className="text-xs text-muted-foreground text-center">
                                            Fecha seleccionada: {format(selectedDate, "EEEE, d 'de' MMMM yyyy", { locale: es })}
                                        </p>
                                        {formData.appointment_type === 'prioridad' && (
                                            <div className="mt-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm flex items-center gap-2" data-testid="priority-notice">
                                                <AlertCircle className="w-4 h-4 shrink-0" />
                                                Prioridad: se agenda inmediatamente sin importar franjas ni cupos.
                                            </div>
                                        )}
                                    </div>
                                    {formData.appointment_type !== 'prioridad' && (
                                    <div className="space-y-2">
                                        <Label className="flex items-center gap-2">
                                            <Clock className="w-4 h-4" />
                                            Franja Horaria *
                                        </Label>
                                        {!slotsAvailability?.is_open ? (
                                            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 flex items-center gap-2">
                                                <AlertCircle className="w-5 h-5" />
                                                <span>El día seleccionado no tiene servicio</span>
                                            </div>
                                        ) : loadingSlots ? (
                                            <div className="flex justify-center py-4">
                                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                {slotsAvailability?.slots?.map((slot) => {
                                                    const isTimeAvailable = isSlotAvailableByTime(slot);
                                                    const isAvailable = slot.available && isTimeAvailable;
                                                    const isPastSlot = !isTimeAvailable;
                                                    
                                                    return (
                                                        <div
                                                            key={slot.id}
                                                            className={`p-3 rounded-lg border transition-all ${
                                                                formData.time_slot === slot.id
                                                                    ? 'border-primary bg-primary/10 cursor-pointer'
                                                                    : isAvailable
                                                                    ? 'border-border hover:border-primary/50 bg-card cursor-pointer'
                                                                    : isPastSlot
                                                                    ? 'border-border bg-muted/30 opacity-40 cursor-not-allowed'
                                                                    : 'border-border bg-muted/50 opacity-60 cursor-not-allowed'
                                                            }`}
                                                            onClick={() => isAvailable && handleTimeSlotChange(slot.id)}
                                                            data-testid={`slot-${slot.id}`}
                                                        >
                                                            <div className="flex items-center justify-between">
                                                                <div className="flex items-center gap-3">
                                                                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                                                                        formData.time_slot === slot.id
                                                                            ? 'border-primary bg-primary'
                                                                            : 'border-muted-foreground'
                                                                    }`}>
                                                                        {formData.time_slot === slot.id && (
                                                                            <div className="w-2 h-2 rounded-full bg-white" />
                                                                        )}
                                                                    </div>
                                                                    <div>
                                                                        <p className={`font-medium ${isPastSlot ? 'line-through text-muted-foreground' : ''}`}>
                                                                            {slot.name}
                                                                            {isPastSlot && <span className="text-xs ml-2 text-red-400">(Franja pasada)</span>}
                                                                        </p>
                                                                        <p className="text-sm text-muted-foreground">
                                                                            {slot.start} - {slot.end}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <Users className="w-4 h-4 text-muted-foreground" />
                                                                    <span className={`text-sm font-medium ${
                                                                        isPastSlot
                                                                            ? 'text-muted-foreground'
                                                                            : slot.remaining === 0
                                                                            ? 'text-red-500'
                                                                            : slot.remaining <= 3
                                                                            ? 'text-yellow-500'
                                                                            : 'text-green-500'
                                                                    }`}>
                                                                        {slot.remaining} / {slot.capacity}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                <p className="text-xs text-muted-foreground">
                                                    * Registro hasta las {slotsAvailability?.last_registration}
                                                </p>
                                                {format(selectedDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd') && (
                                                    <p className="text-xs text-cyan-400 mt-1">
                                                        * Las franjas ya finalizadas no están disponibles
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    )}
                                </div>
                            </div>

                            {/* Services by Category */}
                            {formData.appointment_type === 'postventa' ? (
                            <div className="space-y-4">
                                <h3 className="font-heading text-lg flex items-center gap-2">
                                    <Package className="w-4 h-4" />
                                    Servicios de Postventa
                                </h3>
                                <p className="text-sm text-muted-foreground -mt-2">
                                    Agrega los servicios que se harán. El valor puede ser $0, y puedes marcar &quot;Sin pago&quot; los que no se cobran.
                                </p>
                                <PostventaServicesTable
                                    rows={postventaServices}
                                    onChange={setPostventaServices}
                                    catalog={serviceCatalog}
                                />
                            </div>
                            ) : (
                            <div className="space-y-4">
                                <h3 className="font-heading text-lg flex items-center gap-2">
                                    <Package className="w-4 h-4" />
                                    Servicios *
                                </h3>
                                <Accordion type="multiple" className="w-full">
                                    {Object.entries(serviceCatalog).map(([categoryId, category]) => (
                                        <AccordionItem key={categoryId} value={categoryId}>
                                            <AccordionTrigger className="hover:no-underline">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium">{category.name}</span>
                                                    {selectedServices.filter(s => 
                                                        category.services.some(cs => cs.id === s.serviceId)
                                                    ).length > 0 && (
                                                        <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
                                                            {selectedServices.filter(s => 
                                                                category.services.some(cs => cs.id === s.serviceId)
                                                            ).length}
                                                        </span>
                                                    )}
                                                </div>
                                            </AccordionTrigger>
                                            <AccordionContent>
                                                <div className="space-y-2 pt-2">
                                                    {category.services.map((service) => {
                                                        const isSelected = selectedServices.some(s => s.serviceId === service.id);
                                                        const selectedService = selectedServices.find(s => s.serviceId === service.id);
                                                        const showParts = isSelected && serviceRequiresParts(service.id);
                                                        return (
                                                            <div
                                                                key={service.id}
                                                                className={`p-3 rounded-lg border transition-colors ${
                                                                    isSelected ? 'border-primary bg-primary/5' : 'border-border'
                                                                }`}
                                                            >
                                                                <div className="flex items-center gap-3">
                                                                    <Checkbox
                                                                        id={`svc-${service.id}`}
                                                                        checked={isSelected}
                                                                        onCheckedChange={() => handleServiceToggle(service.id, service.name, category.name)}
                                                                        data-testid={`service-${service.id}`}
                                                                    />
                                                                    <label 
                                                                        htmlFor={`svc-${service.id}`} 
                                                                        className="flex-1 cursor-pointer"
                                                                    >
                                                                        {service.name}
                                                                    </label>
                                                                    {isSelected && (
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-sm text-muted-foreground">$</span>
                                                                            <Input
                                                                                type="number"
                                                                                min="0"
                                                                                value={selectedService?.price || ''}
                                                                                onChange={(e) => handleServicePriceChange(service.id, e.target.value)}
                                                                                placeholder="Valor"
                                                                                className="w-32 h-8 text-right"
                                                                                onClick={(e) => e.stopPropagation()}
                                                                                data-testid={`price-${service.id}`}
                                                                            />
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                {/* Vehicle parts selection for polarizado services */}
                                                                {showParts && (
                                                                    <div className="mt-3 pt-3 border-t border-border/50">
                                                                        <div className="flex items-center justify-between mb-2">
                                                                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                                                                                <Car className="w-3 h-3" />
                                                                                Selecciona las partes del vehículo:
                                                                            </p>
                                                                            <Button
                                                                                type="button"
                                                                                size="sm"
                                                                                variant={selectedService?.parts?.length === VEHICLE_PARTS.length ? 'default' : 'outline'}
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    handleSelectAllParts(service.id);
                                                                                }}
                                                                                data-testid={`select-all-parts-${service.id}`}
                                                                                className="h-7 text-xs"
                                                                            >
                                                                                {selectedService?.parts?.length === VEHICLE_PARTS.length ? '✓ Completo' : 'Completo'}
                                                                            </Button>
                                                                        </div>
                                                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                                                            {VEHICLE_PARTS.map((part) => {
                                                                                const isPartSelected = selectedService?.parts?.includes(part.id);
                                                                                return (
                                                                                    <div
                                                                                        key={part.id}
                                                                                        className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                                                                                            isPartSelected 
                                                                                                ? 'bg-cyan-500/20 border border-cyan-500/40' 
                                                                                                : 'bg-muted/30 hover:bg-muted/50 border border-transparent'
                                                                                        }`}
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            handlePartToggle(service.id, part.id);
                                                                                        }}
                                                                                        data-testid={`part-${service.id}-${part.id}`}
                                                                                    >
                                                                                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                                                                                            isPartSelected 
                                                                                                ? 'bg-cyan-500 border-cyan-500' 
                                                                                                : 'border-muted-foreground/50'
                                                                                        }`}>
                                                                                            {isPartSelected && (
                                                                                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                                                                </svg>
                                                                                            )}
                                                                                        </div>
                                                                                        <span className="text-xs select-none">
                                                                                            {part.name}
                                                                                        </span>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                        {selectedService?.parts?.includes('sunroof') && (
                                                                            <div className="mt-3 p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 space-y-1" data-testid={`sunroof-extra-${service.id}`}>
                                                                                <Label className="text-xs text-amber-400 flex items-center gap-1">
                                                                                    <DollarSign className="w-3 h-3" />
                                                                                    Sunroof · costo adicional (personalizado)
                                                                                </Label>
                                                                                <Input
                                                                                    type="number"
                                                                                    min="0"
                                                                                    value={selectedService?.sunroof_price || ''}
                                                                                    onChange={(e) => handleSunroofPriceChange(service.id, e.target.value)}
                                                                                    onClick={(e) => e.stopPropagation()}
                                                                                    placeholder="Ingresa el valor extra por Sunroof"
                                                                                    data-testid={`sunroof-price-${service.id}`}
                                                                                    className="h-8"
                                                                                />
                                                                            </div>
                                                                        )}
                                                                        {selectedService?.parts?.length > 0 && (
                                                                            <p className="text-xs text-cyan-400 mt-2">
                                                                                {selectedService.parts.length} parte(s) seleccionada(s)
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </AccordionContent>
                                        </AccordionItem>
                                    ))}
                                </Accordion>

                                {/* Custom Service Input */}
                                <div className="p-4 rounded-lg border border-dashed border-muted-foreground/50 space-y-3">
                                    <Label className="flex items-center gap-2 text-muted-foreground">
                                        <PlusCircle className="w-4 h-4" />
                                        Agregar Servicio/Producto Personalizado
                                    </Label>
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <Input
                                            value={customServiceName}
                                            onChange={(e) => setCustomServiceName(e.target.value)}
                                            placeholder="Nombre del servicio o producto"
                                            className="flex-1"
                                            data-testid="custom-service-name"
                                        />
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center gap-1 flex-1 sm:flex-initial">
                                                <span className="text-sm text-muted-foreground">$</span>
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    value={customServicePrice}
                                                    onChange={(e) => setCustomServicePrice(e.target.value)}
                                                    placeholder="Valor"
                                                    className="w-full sm:w-28"
                                                    data-testid="custom-service-price"
                                                />
                                            </div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="icon"
                                                onClick={handleAddCustomService}
                                                className="flex-shrink-0"
                                                data-testid="add-custom-service-btn"
                                            >
                                                <Plus className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>

                                {/* Selected Services Summary */}
                                {selectedServices.length > 0 && (
                                    <div className="p-4 rounded-lg bg-primary/10 border border-primary/30 space-y-3">
                                        <p className="font-medium">Servicios seleccionados:</p>
                                        <div className="space-y-3">
                                            {selectedServices.map((svc) => (
                                                <div key={svc.serviceId} className="text-sm">
                                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                                            {svc.isCustom && (
                                                                <span className="text-xs bg-yellow-500/20 text-yellow-500 px-1.5 py-0.5 rounded flex-shrink-0">
                                                                    Personalizado
                                                                </span>
                                                            )}
                                                            <span className="font-medium truncate">{svc.serviceName}</span>
                                                        </div>
                                                        <div className="flex items-center justify-between sm:justify-end gap-2 flex-shrink-0">
                                                            <span className="font-mono text-base">{formatCurrency(svc.price)}</span>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-6 w-6 text-red-500 hover:text-red-600"
                                                                onClick={() => handleRemoveService(svc.serviceId)}
                                                            >
                                                                <Trash2 className="w-3 h-3" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                    {/* Show selected parts for polarizado services */}
                                                    {svc.parts && svc.parts.length > 0 && (
                                                        <div className="mt-1 ml-4 flex flex-wrap gap-1">
                                                            {svc.parts.map(partId => {
                                                                const part = VEHICLE_PARTS.find(p => p.id === partId);
                                                                return (
                                                                    <span 
                                                                        key={partId}
                                                                        className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded"
                                                                    >
                                                                        {part?.name || partId}
                                                                    </span>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                        <div className="flex justify-between font-bold pt-2 border-t border-primary/30">
                                            <span>Total:</span>
                                            <span className="text-primary">{formatCurrency(calculateTotal())}</span>
                                        </div>
                                        {discountApplied && (
                                            <div className="pt-2 mt-2 border-t border-emerald-500/30 space-y-1 text-sm" data-testid="appointment-discount-summary">
                                                <div className="flex justify-between text-emerald-300">
                                                    <span>Descuento ({discountApplied.code}
                                                        {discountApplied.discount_type === 'percentage' ? ` · ${discountApplied.discount_value}%` : ''})
                                                    </span>
                                                    <span className="font-mono">-{formatCurrency(discountApplied.discount_amount)}</span>
                                                </div>
                                                <div className="flex justify-between font-bold text-emerald-300">
                                                    <span>Total con descuento:</span>
                                                    <span>{formatCurrency(discountApplied.new_total)}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                            )}

                            {/* Código de descuento */}
                            <div className="space-y-2 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
                                <Label htmlFor="discount_code" className="flex items-center gap-2 text-emerald-400">
                                    <DollarSign className="w-4 h-4" />
                                    Código de descuento (opcional)
                                </Label>
                                <div className="flex gap-2">
                                    <Input
                                        id="discount_code"
                                        value={formData.discount_code}
                                        onChange={(e) => {
                                            const v = e.target.value.toUpperCase();
                                            setFormData(prev => ({ ...prev, discount_code: v }));
                                            if (discountApplied && v !== discountApplied.code) setDiscountApplied(null);
                                        }}
                                        placeholder="Ej: PROMO10"
                                        disabled={!!discountApplied}
                                        data-testid="appointment-discount-input"
                                    />
                                    {discountApplied ? (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={handleRemoveDiscount}
                                            data-testid="appointment-discount-remove-btn"
                                        >
                                            Quitar
                                        </Button>
                                    ) : (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={handleValidateDiscount}
                                            disabled={validatingDiscount || !formData.discount_code || calculateTotal() <= 0}
                                            data-testid="appointment-discount-apply-btn"
                                        >
                                            {validatingDiscount ? 'Validando...' : 'Aplicar'}
                                        </Button>
                                    )}
                                </div>
                                {discountApplied && (
                                    <p className="text-xs text-emerald-300" data-testid="appointment-discount-applied-msg">
                                        Descuento aplicado: -{formatCurrency(discountApplied.discount_amount)} · Total: {formatCurrency(discountApplied.new_total)}
                                    </p>
                                )}
                            </div>

                            {/* Notes */}
                            <div className="space-y-2">
                                <Label htmlFor="notes">Notas</Label>
                                <Textarea
                                    id="notes"
                                    value={formData.notes}
                                    onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                                    placeholder="Observaciones adicionales..."
                                    data-testid="appointment-notes"
                                />
                            </div>

                            {/* Confirmation PIN o Código de autorización */}
                            {formData.appointment_type === 'prioridad' ? (
                                <div className="space-y-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
                                    <Label htmlFor="authorization_code" className="flex items-center gap-2 text-amber-400">
                                        <AlertCircle className="w-4 h-4" />
                                        Código de Autorización *
                                    </Label>
                                    <Input
                                        id="authorization_code"
                                        type="password"
                                        inputMode="numeric"
                                        autoComplete="off"
                                        maxLength={10}
                                        value={formData.authorization_code}
                                        onChange={(e) => setFormData(prev => ({ ...prev, authorization_code: e.target.value.replace(/\D/g, '') }))}
                                        placeholder="Ingresa el código de autorización"
                                        required
                                        data-testid="appointment-auth-code-input"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Las citas por prioridad requieren autorización del administrador.
                                    </p>
                                    <div className="mt-2">
                                        <Label htmlFor="priority_reason" className="text-xs">Motivo de prioridad (opcional)</Label>
                                        <Input
                                            id="priority_reason"
                                            value={formData.priority_reason}
                                            onChange={(e) => setFormData(prev => ({ ...prev, priority_reason: e.target.value }))}
                                            placeholder="Ej: Cliente VIP, emergencia..."
                                            data-testid="appointment-priority-reason"
                                        />
                                    </div>
                                </div>
                            ) : formData.appointment_type === 'postventa' ? (
                                <div className="space-y-3 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5" data-testid="postventa-section">
                                    <div className="space-y-2">
                                        <Label htmlFor="postventa_motivo">Motivo de la postventa *</Label>
                                        <Textarea
                                            id="postventa_motivo"
                                            value={formData.postventa_motivo}
                                            onChange={(e) => setFormData(prev => ({ ...prev, postventa_motivo: e.target.value }))}
                                            placeholder="Describe qué se debe revisar o corregir..."
                                            className="h-20"
                                            data-testid="appointment-postventa-motivo"
                                        />
                                        {formData.original_order_id && (
                                            <p className="text-xs text-muted-foreground">Vinculada al último servicio registrado de este cliente.</p>
                                        )}
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="postventa_code" className="flex items-center gap-2 text-emerald-400">
                                            <Lock className="w-4 h-4" />
                                            Contraseña de Postventa *
                                        </Label>
                                        <Input
                                            id="postventa_code"
                                            type="password"
                                            inputMode="numeric"
                                            autoComplete="off"
                                            maxLength={10}
                                            value={formData.postventa_code}
                                            onChange={(e) => setFormData(prev => ({ ...prev, postventa_code: e.target.value.replace(/\D/g, '') }))}
                                            placeholder="Ingresa la contraseña de postventa"
                                            data-testid="appointment-postventa-code"
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
                                    <Label htmlFor="confirmation_pin" className="flex items-center gap-2 text-amber-400">
                                        <AlertCircle className="w-4 h-4" />
                                        PIN de Confirmación *
                                    </Label>
                                    <Input
                                        id="confirmation_pin"
                                        type="password"
                                        inputMode="numeric"
                                        autoComplete="off"
                                        maxLength={10}
                                        value={formData.confirmation_pin}
                                        onChange={(e) => setFormData(prev => ({ ...prev, confirmation_pin: e.target.value.replace(/\D/g, '') }))}
                                        placeholder="Ingresa el PIN para confirmar"
                                        required
                                        data-testid="appointment-pin-input"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Se requiere PIN para evitar duplicados. Configúralo en Ajustes (Admin).
                                    </p>
                                </div>
                            )}

                            <Button 
                                type="submit" 
                                className="w-full brand-glow" 
                                data-testid="submit-appointment-btn"
                                disabled={
                                    (selectedServices.length === 0 && formData.appointment_type !== 'postventa') ||
                                    (formData.appointment_type === 'franja' && (!slotsAvailability?.is_open || !formData.confirmation_pin)) ||
                                    (formData.appointment_type === 'prioridad' && !formData.authorization_code) ||
                                    (formData.appointment_type === 'postventa' && (!slotsAvailability?.is_open || !formData.postventa_code))
                                }
                            >
                                <DollarSign className="w-4 h-4 mr-2" />
                                Agendar Cita - {formatCurrency(discountApplied ? discountApplied.new_total : calculateTotal())}
                            </Button>
                        </form>
                    </DialogContent>
                </Dialog>

                <AppointmentConfirmDialog
                    open={confirmOpen}
                    onOpenChange={setConfirmOpen}
                    sections={confirmOpen ? confirmSections() : []}
                    onConfirm={createAppointment}
                    submitting={submitting}
                />

                {/* Placa o documento ya registrados */}
                <Dialog open={!!existingMatch} onOpenChange={(open) => !open && setExistingMatch(null)}>
                    <DialogContent
                        className="max-w-md"
                        onInteractOutside={(e) => e.preventDefault()}
                        data-testid="existing-client-dialog"
                    >
                        {existingMatch && (
                            <>
                                <DialogHeader>
                                    <DialogTitle className="font-heading text-xl">
                                        {existingMatch.source === 'plate' ? 'Esta placa ya está registrada' : 'Este documento ya está registrado'}
                                    </DialogTitle>
                                    <DialogDescription>
                                        {existingMatch.source === 'plate' ? 'Placa' : 'Documento'} <strong>{existingMatch.value}</strong> tiene{' '}
                                        {existingMatch.data.total_orders} servicio(s) registrado(s). ¿Cómo desea registrar esta cita?
                                    </DialogDescription>
                                </DialogHeader>
                                {existingMatch.data.last_order && (
                                    <div className="rounded-lg border p-3 text-sm space-y-1">
                                        <p className="text-muted-foreground">Último servicio</p>
                                        <div className="flex items-center justify-between gap-2">
                                            <PlateBadge plate={existingMatch.data.last_order.plate} size="md" />
                                            <OrderStatusBadge status={existingMatch.data.last_order.status} />
                                        </div>
                                        <p>
                                            {existingMatch.data.client_data?.client_name} · {existingMatch.data.last_order.date} · {existingMatch.data.last_order.order_code}
                                        </p>
                                        {existingMatch.data.last_order.services?.length > 0 && (
                                            <p className="text-muted-foreground">{existingMatch.data.last_order.services.join(', ')}</p>
                                        )}
                                    </div>
                                )}
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="sm:flex-1"
                                        onClick={() => applyExistingMatch(false)}
                                        data-testid="existing-as-new-btn"
                                    >
                                        Servicio nuevo
                                    </Button>
                                    <Button
                                        type="button"
                                        className="sm:flex-1 brand-glow"
                                        onClick={() => applyExistingMatch(true)}
                                        data-testid="existing-as-postventa-btn"
                                    >
                                        Es postventa
                                    </Button>
                                </div>
                            </>
                        )}
                    </DialogContent>
                </Dialog>
            </div>

            {/* Calendar and Schedule */}
            <div className="grid lg:grid-cols-3 gap-6">
                {/* Calendar */}
                <Card className="card-hover">
                    <CardHeader>
                        <CardTitle className="font-heading text-lg flex items-center gap-2">
                            <CalendarIcon className="w-5 h-5 text-primary" />
                            Calendario
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex justify-center">
                        <Calendar
                            mode="single"
                            selected={selectedDate}
                            onSelect={handleDateSelect}
                            locale={es}
                            className="rounded-md border"
                            disabled={disabledDays}
                            data-testid="appointment-calendar"
                        />
                    </CardContent>
                    <CardContent className="pt-0">
                        <div className="p-3 rounded-lg bg-muted/50 text-sm space-y-1">
                            <p className="font-medium">Horarios de operación:</p>
                            <p className="text-muted-foreground">Lun-Vie: 8:30 AM - 6:00 PM</p>
                            <p className="text-muted-foreground">Sábados: 7:30 AM - 6:00 PM</p>
                            <p className="text-red-400 text-xs mt-1">Domingos: Cerrado</p>
                        </div>
                    </CardContent>
                </Card>

                {/* Schedule */}
                <Card className="lg:col-span-2 card-hover">
                    <CardHeader>
                        <CardTitle className="font-heading text-lg flex items-center gap-2">
                            <Clock className="w-5 h-5 text-primary" />
                            {format(selectedDate, "EEEE, d 'de' MMMM", { locale: es })}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {loading || loadingSlots ? (
                            <div className="flex justify-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                            </div>
                        ) : !slotsAvailability?.is_open ? (
                            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                <AlertCircle className="w-16 h-16 mb-4 text-red-400" />
                                <p className="text-lg font-medium">Día no disponible</p>
                                <p className="text-sm">{slotsAvailability?.message || 'Selecciona otro día'}</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {slotsAvailability?.slots?.map((slot) => {
                                    const slotOrders = ordersBySlot[slot.id] || [];
                                    return (
                                        <div 
                                            key={slot.id}
                                            className="rounded-lg border bg-card overflow-hidden"
                                            data-testid={`time-slot-${slot.id}`}
                                        >
                                            <div className="flex items-center justify-between p-3 bg-muted/30 border-b">
                                                <div>
                                                    <p className="font-medium">{slot.name}</p>
                                                    <p className="text-sm text-muted-foreground font-mono">
                                                        {slot.start} - {slot.end}
                                                    </p>
                                                </div>
                                                <div className={`px-3 py-1 rounded-full text-sm font-medium flex items-center gap-1 ${
                                                    slot.remaining === 0
                                                        ? 'bg-red-500/10 text-red-500'
                                                        : slot.remaining <= 3
                                                        ? 'bg-yellow-500/10 text-yellow-500'
                                                        : 'bg-green-500/10 text-green-500'
                                                }`}>
                                                    <Users className="w-3 h-3" />
                                                    {slot.remaining} disponibles
                                                </div>
                                            </div>
                                            <div className="p-3">
                                                {slotOrders.length === 0 ? (
                                                    <p className="text-sm text-muted-foreground text-center py-2">
                                                        Sin citas agendadas
                                                    </p>
                                                ) : (
                                                    <div className="space-y-2">
                                                        {slotOrders.map((order) => (
                                                            <div 
                                                                key={order.id}
                                                                className="flex items-center justify-between p-2 rounded bg-muted/30 hover:bg-muted/50 transition-colors gap-2"
                                                                data-testid={`order-card-${order.order_code}`}
                                                            >
                                                                <CarAvatar photoUrl={order.profile_photo_url} size={40} />
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-2 flex-wrap">
                                                                        {/* Hora específica */}
                                                                        {order.scheduled_time && (
                                                                            <span className="text-sm font-mono font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded">
                                                                                {order.scheduled_time}
                                                                            </span>
                                                                        )}
                                                                        <PlateBadge plate={order.plate} size="md" />
                                                                        <PostventaBadge order={order} />
                                                                        <p className="font-medium truncate">{order.client_name}</p>
                                                                        <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                                                                            <QrCode className="w-3 h-3" />
                                                                            {order.order_code}
                                                                        </span>
                                                                    </div>
                                                                    <p className="text-sm text-muted-foreground">
                                                                        {order.brand} {order.model}
                                                                    </p>
                                                                    {order.created_by_name && (
                                                                        <p className="text-xs text-purple-400 flex items-center gap-1 mt-0.5" data-testid={`asesor-tag-${order.id}`}>
                                                                            <UserCog className="w-3 h-3" />
                                                                            Asesor: {order.created_by_name}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-2 shrink-0">
                                                                    <div className="hidden sm:flex gap-1">
                                                                        {order.services?.slice(0, 2).map((s, idx) => (
                                                                            <ServiceBadge key={idx} service={s.service || s} />
                                                                        ))}
                                                                    </div>
                                                                    {order.status === 'agendado' && (
                                                                        <Button
                                                                            size="sm"
                                                                            variant="outline"
                                                                            onClick={(e) => { e.stopPropagation(); openReschedule(order); }}
                                                                            className="border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10"
                                                                            data-testid={`reschedule-btn-${order.id}`}
                                                                        >
                                                                            <CalendarClock className="w-3 h-3 mr-1" />
                                                                            Reasignar
                                                                        </Button>
                                                                    )}
                                                                    <OrderStatusBadge status={order.status} />
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Dialog Reasignar Cita */}
            <Dialog open={!!rescheduleOrder} onOpenChange={(v) => !v && closeReschedule()}>
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <CalendarClock className="w-5 h-5 text-cyan-400" />
                            Reasignar Cita
                        </DialogTitle>
                        <DialogDescription asChild>
                            {rescheduleOrder ? (
                                <div className="pt-1 space-y-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <PlateBadge plate={rescheduleOrder.plate} size="md" />
                                        <span className="text-sm">{rescheduleOrder.client_name}</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Actual: <b>{rescheduleOrder.date}</b> · <b className="text-cyan-400">{rescheduleOrder.scheduled_time || rescheduleOrder.time_slot}</b>
                                    </p>
                                </div>
                            ) : <span />}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label>Nueva Fecha *</Label>
                            <div className="flex justify-center border rounded-lg p-2 overflow-x-auto">
                                <Calendar
                                    mode="single"
                                    selected={rsDate}
                                    onSelect={handleRsDateChange}
                                    locale={es}
                                    disabled={disabledDays}
                                    className="rounded-md"
                                />
                            </div>
                            <p className="text-xs text-muted-foreground text-center mt-1">
                                Nueva fecha: <b className="text-cyan-400">{format(rsDate, "EEEE, d 'de' MMMM yyyy", { locale: es })}</b>
                            </p>
                        </div>

                        <div>
                            <Label className="flex items-center gap-1"><Clock className="w-3 h-3" /> Nueva Franja *</Label>
                            <div className="grid grid-cols-1 gap-2 mt-1">
                                <button
                                    type="button"
                                    onClick={() => setRsSlot('prioridad')}
                                    className={`p-2 rounded-lg border text-left text-sm transition-all ${
                                        rsSlot === 'prioridad'
                                            ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                                            : 'border-border hover:border-amber-500/50'
                                    }`}
                                    data-testid="rs-slot-prioridad"
                                >
                                    ⚡ <b>Prioridad</b> · se agenda inmediatamente (sin franja)
                                </button>
                                {(rsSlotsAvailability?.slots || []).map(slot => (
                                    <button
                                        key={slot.id}
                                        type="button"
                                        onClick={() => setRsSlot(slot.id)}
                                        disabled={slot.remaining <= 0}
                                        className={`p-2 rounded-lg border text-left text-sm transition-all ${
                                            rsSlot === slot.id
                                                ? 'border-cyan-500 bg-cyan-500/10 text-cyan-400'
                                                : slot.remaining <= 0
                                                ? 'border-muted bg-muted/30 opacity-50 cursor-not-allowed'
                                                : 'border-border hover:border-cyan-500/50'
                                        }`}
                                        data-testid={`rs-slot-${slot.id}`}
                                    >
                                        <div className="flex justify-between items-center">
                                            <span><b>{slot.label}</b></span>
                                            <span className={`text-xs ${slot.remaining <= 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                                                {slot.remaining <= 0 ? 'Sin cupos' : `${slot.remaining} cupo(s)`}
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-muted-foreground mt-0.5">{slot.start} - {slot.end}</p>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <Label className="text-xs">Motivo (opcional)</Label>
                            <Textarea
                                value={rsReason}
                                onChange={(e) => setRsReason(e.target.value)}
                                placeholder="Ej: Cliente llamó a posponer, urgencia familiar..."
                                rows={2}
                                data-testid="rs-reason-input"
                            />
                        </div>

                        <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
                            <Label className="flex items-center gap-1 text-amber-400">
                                <Lock className="w-4 h-4" />
                                Contraseña de autorización *
                            </Label>
                            <Input
                                type="password"
                                inputMode="numeric"
                                autoComplete="off"
                                maxLength={10}
                                value={rsPassword}
                                onChange={(e) => setRsPassword(e.target.value.replace(/\D/g, ''))}
                                placeholder="Ingresa la contraseña"
                                className="mt-2"
                                data-testid="rs-password-input"
                            />
                            <p className="text-[11px] text-muted-foreground mt-1">
                                Solo administradores tienen esta contraseña. Configurable en /settings.
                            </p>
                        </div>

                        <Button
                            onClick={submitReschedule}
                            disabled={rsLoading || !rsSlot || !rsPassword.trim()}
                            className="w-full brand-glow"
                            data-testid="rs-confirm-btn"
                        >
                            {rsLoading ? (
                                <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" /> Reagendando...</>
                            ) : (
                                <><CalendarClock className="w-4 h-4 mr-2" /> Reagendar y enviar correo</>
                            )}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default Appointments;
