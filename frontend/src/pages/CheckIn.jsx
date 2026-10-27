import React, { useState, useCallback, useEffect } from 'react';
import { ordersAPI, servicesAPI, serviceExtrasAPI, discountCodesAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Checkbox } from '../components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { ScrollArea } from '../components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../components/ui/accordion';
import { QRScanner } from '../components/QRScanner';
import { QRDisplay } from '../components/QRDisplay';
import { OrderStatusBadge } from '../components/OrderStatusBadge';
import { ServiceBadge } from '../components/ServiceBadge';
import { formatCurrency, VEHICLE_PARTS, PPF_PARTS, CHECKIN_NOTICES } from '../lib/utils';
import { SUNROOF_ID, isSunroofExtra, isSunroofLine, findSunroof, stripSunroof, buildSunroofLine } from '../lib/sunroof';
import { generateOrderPDF } from '../components/OrderPDFGenerator';
import { Inspection360Inline } from '../components/Inspection360Inline';
import { toast } from 'sonner';
import { 
    QrCode, Search, Car, User, Phone, FileCheck, 
    Pen, CheckCircle, Plus, DollarSign, ArrowRight,
    Clock, AlertTriangle, Timer, Shield, Package, Trash2, PlusCircle, Download, FileText
} from 'lucide-react';
import api from '../lib/api';
import { PostventaBadge } from '../components/PostventaBadge';
import { ServiceCatalogLabel } from '../components/ServiceCatalogLabel';
import { CheckinConfirmDialog } from '../components/CheckinConfirmDialog';

// El sunroof nunca va dentro de un servicio: es un adicional con valor personalizable
const SERVICE_PARTS = VEHICLE_PARTS.filter(p => p.id !== 'sunroof');

// En celulares y tabletas se abre primero el escáner de QR con la cámara
const PREFERS_SCAN = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

export const CheckIn = () => {
    const [step, setStep] = useState(1);
    const [orderCode, setOrderCode] = useState('');
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(false);
    const [serviceCatalog, setServiceCatalog] = useState({});
    const [colombiaTime, setColombiaTime] = useState(null);
    const [waitingInfo, setWaitingInfo] = useState(null);
    
    // Services with prices (upsell support)
    const [selectedServices, setSelectedServices] = useState([]);
    // { serviceId: string, serviceName: string, category: string, price: number, isCustom?: boolean }
    
    // Custom service input
    const [customServiceName, setCustomServiceName] = useState('');
    const [customServicePrice, setCustomServicePrice] = useState('');
    
    const [signature, setSignature] = useState(null);
    const [cedulaNumber, setCedulaNumber] = useState('');
    const [profilePhoto, setProfilePhoto] = useState(null);  // foto frontal del vehículo
    const [inspectionPhotosCount, setInspectionPhotosCount] = useState(0);
    const [sendingPhotos, setSendingPhotos] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState('efectivo'); // efectivo | tarjeta | transferencia
    const [requiresInvoice, setRequiresInvoice] = useState(false);
    // Código de descuento
    const [discountCodeInput, setDiscountCodeInput] = useState('');
    const [discountApplied, setDiscountApplied] = useState(null); // { code, discount_type, discount_value, discount_amount, new_total }
    const [validatingDiscount, setValidatingDiscount] = useState(false);
    // Sunroof adicional (fuera de los servicios): { enabled, price, percentage }
    const [sunroof, setSunroof] = useState({ enabled: false, price: '', percentage: '' });
    // Input transitorio del selector predictivo de partes PPF: { serviceId: texto }
    const [ppfPartInputs, setPpfPartInputs] = useState({});
    
    // Risk Agreement Modal
    const [showRiskAgreement, setShowRiskAgreement] = useState(false);
    const [riskAgreementAccepted, setRiskAgreementAccepted] = useState(false);
    // Confirmación final con el cliente (orden + avisos, se pregunta 2 veces)
    const [confirmIngresoOpen, setConfirmIngresoOpen] = useState(false);
    const [riskChecks, setRiskChecks] = useState({
        retiroPolarizado: false,
        vidriosBlinados: false,
        instalacionEncima: false,
        autorizaciones: false,
        porcentajes: false,
        datosPersonales: false
    });

    // Fetch Colombia time
    useEffect(() => {
        const fetchTime = async () => {
            try {
                const res = await api.get('/time/colombia');
                setColombiaTime(res.data);
            } catch (error) {
                console.error('Error fetching time:', error);
            }
        };
        fetchTime();
        const interval = setInterval(fetchTime, 30000);
        return () => clearInterval(interval);
    }, []);

    // Handle QR scan result
    const handleQRScan = async (scannedCode) => {
        if (!scannedCode) return;
        toast.success(`QR leído: ${scannedCode}`);
        setOrderCode(scannedCode);
        await searchOrder(scannedCode);
    };

    // Search order by code
    const searchOrder = async (code) => {
        if (!code.trim()) {
            toast.error('Ingresa un código de cita');
            return;
        }

        setLoading(true);
        setWaitingInfo(null);
        try {
            const [orderRes, catalogRes] = await Promise.all([
                ordersAPI.checkin(code.trim().toUpperCase()),
                servicesAPI.getCatalog()
            ]);
            
            setOrder(orderRes.data);
            setServiceCatalog(catalogRes.data);
            
            // El sunroof se separa de los servicios: si venía como parte, extra o línea propia
            // del agendamiento, pasa al bloque "Sunroof (adicional)" con su valor.
            const orderServices = orderRes.data.services || [];
            const sunroofFound = findSunroof(orderServices);
            setSunroof(sunroofFound
                ? { enabled: true, price: sunroofFound.price != null ? String(sunroofFound.price) : '', percentage: sunroofFound.percentage || '' }
                : { enabled: false, price: '', percentage: '' });

            // Initialize services from order with prices, parts and extras
            const initialServices = orderServices.filter(s => !isSunroofLine(s)).map(stripSunroof).map(s => {
                return {
                serviceId: s.service,
                serviceName: s.description?.split(' - ')[1] || s.service,
                category: s.description?.split(' - ')[0] || 'Servicio',
                price: s.price || 0,
                no_charge: !!s.no_charge,
                parts: s.parts,
                part_percentages: s.part_percentages,
                extras: s.extras,
                ppf_scope: s.ppf_scope || (s.service === 'ppf_full_body' ? 'full' : s.service === 'ppf_partes' ? 'partes' : null),
                ppf_finish: s.ppf_finish || null,
                ppf_color: s.ppf_color || '',
                ppf_zones: s.ppf_zones || [],
                ppf_parts: s.ppf_parts || [],
                };
            });
            setSelectedServices(initialServices);
            // Postventa con todos los servicios sin pago: la forma de pago queda en "Sin pago"
            if (orderRes.data.is_postventa && initialServices.length > 0 && initialServices.every(s => s.no_charge)) {
                setPaymentMethod('sin_pago');
            }
            setCedulaNumber(orderRes.data.client_cedula || '');
            
            // Precargar descuento aplicado en el agendamiento (si existe)
            if (orderRes.data.discount_code) {
                setDiscountCodeInput(orderRes.data.discount_code);
                setDiscountApplied({
                    code: orderRes.data.discount_code,
                    discount_type: orderRes.data.discount_type,
                    discount_value: orderRes.data.discount_value,
                    discount_amount: orderRes.data.discount_amount,
                    new_total: null,
                    from_appointment: true,
                });
            } else {
                setDiscountCodeInput('');
                setDiscountApplied(null);
            }
            
            setStep(2);
            toast.success('Orden encontrada');
        } catch (error) {
            const errorData = error.response?.data?.detail;
            
            if (errorData && typeof errorData === 'object' && errorData.type === 'time_validation') {
                setWaitingInfo({
                    message: errorData.message,
                    timeRemaining: errorData.time_remaining,
                    scheduledTime: errorData.scheduled_time,
                    slotTime: errorData.slot_time,
                    appointmentDate: errorData.appointment_date
                });
                toast.error(errorData.message);
            } else if (errorData && typeof errorData === 'object' && errorData.type === 'already_checked_in') {
                // Show structured info: the order exists but cannot be checked in again
                toast.error(errorData.message, { duration: 6000 });
                setWaitingInfo({
                    message: errorData.message,
                    timeRemaining: null,
                    scheduledTime: null,
                    slotTime: null,
                    appointmentDate: null,
                    alreadyCheckedIn: true,
                    plate: errorData.plate,
                    orderCode: errorData.order_code,
                    clientName: errorData.client_name,
                    currentStatusLabel: errorData.current_status_label,
                });
            } else {
                const message = typeof errorData === 'string' ? errorData : 'Orden no encontrada';
                toast.error(message);
            }
        } finally {
            setLoading(false);
        }
    };

    // Servicios que requieren selección de vidrios/partes
    const SERVICES_WITH_PARTS = [
        'nanooptik', 'black_ceramic_autobahn', 'ultraoptik_aswf', 
        'ceramic_i3_autobahn', 'ceramic_i3_plus_autobahn', 'huperoptik'
    ];
    
    // Partes del vehículo disponibles para polarizado
    // VEHICLE_PARTS importado desde lib/utils.js (single source of truth)
    
    // Porcentajes de polarizado disponibles
    const TINT_PERCENTAGES = ['5%', '7%', '10%', '12%', '15%', '20%', '30%', '35%', '50%', '70%'];
    
    // Returns true if service is polarizado/ultrasecure (requires percentage per part)
    const serviceRequiresPercentage = (serviceId) => {
        const lower = (serviceId || '').toLowerCase();
        return lower.includes('polarizado') || lower.includes('ultrasecure') ||
               ['nanooptik', 'huperoptik', 'black_ceramic', 'ultraoptik', 'ceramic_i3', 'spectra', 'edge'].some(k => lower.includes(k));
    };

    // Check if service requires parts selection
    const serviceRequiresParts = (serviceId) => {
        return SERVICES_WITH_PARTS.includes(serviceId);
    };

    // Toggle service selection (for upsell)
    const handleServiceToggle = (serviceId, serviceName, categoryName) => {
        setSelectedServices(prev => {
            const exists = prev.find(s => s.serviceId === serviceId);
            if (exists) {
                return prev.filter(s => s.serviceId !== serviceId);
            } else {
                // PPF: el plan viene definido por la opción elegida en el catálogo
                const ppfPreset = serviceId === 'ppf_full_body' ? { ppf_scope: 'full' }
                    : serviceId === 'ppf_partes' ? { ppf_scope: 'partes' }
                    : {};
                return [...prev, { 
                    serviceId, 
                    serviceName, 
                    category: categoryName, 
                    price: 0,
                    parts: serviceRequiresParts(serviceId) ? [] : undefined,
                    ...ppfPreset
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

    // Solo postventa: marcar un servicio sin pago (valor 0)
    const handleServiceNoChargeToggle = (serviceId, checked) => {
        setSelectedServices(prev =>
            prev.map(s => {
                if (s.serviceId !== serviceId) return s;
                // Guarda el valor anterior para devolverlo si se desmarca
                return checked
                    ? { ...s, no_charge: true, price: 0, price_before_no_charge: s.price }
                    : { ...s, no_charge: false, price: s.price_before_no_charge ?? s.price };
            })
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

    // Add custom service
    const handleAddCustomService = () => {
        if (!customServiceName.trim()) {
            toast.error('Ingresa el nombre del servicio o producto');
            return;
        }
        // En postventa el valor puede quedar vacío o en $0
        const customPrice = parseFloat(customServicePrice) || 0;
        if (!order?.is_postventa && customPrice <= 0) {
            toast.error('Ingresa el valor del servicio o producto');
            return;
        }
        
        const customId = `custom_${Date.now()}`;
        setSelectedServices(prev => [...prev, {
            serviceId: customId,
            serviceName: customServiceName.trim(),
            category: 'Personalizado',
            price: customPrice,
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

    // Extras de servicio (Sunroof y otros) cargados desde /settings
    const [serviceExtras, setServiceExtras] = useState([]);

    useEffect(() => {
        (async () => {
            try {
                const res = await serviceExtrasAPI.list();
                setServiceExtras(res.data || []);
            } catch (err) {
                setServiceExtras([]);
            }
        })();
    }, []);

    // Extras que aplican según las partes seleccionadas en los servicios.
    // El sunroof nunca se suma por aquí: va aparte como adicional (sunroofLine).
    const applicableExtras = () => {
        const triggeredIds = new Set();
        selectedServices.forEach(svc => {
            (svc.parts || []).forEach(p => triggeredIds.add(p));
        });
        return serviceExtras.filter(e => e.active && !isSunroofExtra(e)
            && e.trigger_part && triggeredIds.has(e.trigger_part));
    };

    // Precio sugerido del sunroof: el del extra configurado en /settings (si existe)
    const defaultSunroofPrice = () => {
        const ex = serviceExtras.find(e => e.active && isSunroofExtra(e));
        return ex?.price != null ? String(ex.price) : '';
    };

    const sunroofPrice = () => (sunroof.enabled ? (parseFloat(sunroof.price) || 0) : 0);

    // Línea de servicio propia del sunroof para la orden, el PDF y el correo
    const sunroofLine = () => {
        if (!sunroof.enabled) return null;
        return buildSunroofLine(sunroofPrice(), sunroof.percentage);
    };

    // Detecta si algún servicio seleccionado es PPF
    const isPPFService = (svc) => {
        const id = (svc.serviceId || '').toLowerCase();
        const cat = (svc.category || '').toLowerCase();
        const desc = (svc.description || '').toLowerCase();
        return id.includes('ppf') || cat.includes('ppf') || desc.includes('ppf');
    };

    const hasPPFService = () => selectedServices.some(isPPFService);

    // ===== PPF helpers =====
    const updateSvcPPF = (serviceId, patch) => {
        setSelectedServices(prev => prev.map(s => s.serviceId === serviceId ? { ...s, ...patch } : s));
    };
    const handlePpfScopeChange = (serviceId, scope) => {
        // Al cambiar de plan se limpian los campos del otro plan
        const patch = { ppf_scope: scope };
        if (scope === 'full') {
            patch.ppf_zones = [];
            patch.ppf_parts = [];
        }
        updateSvcPPF(serviceId, patch);
        setPpfPartInputs(prev => ({ ...prev, [serviceId]: '' }));
    };
    const togglePpfZone = (serviceId, zone) => {
        const svc = selectedServices.find(s => s.serviceId === serviceId);
        const zones = new Set(svc?.ppf_zones || []);
        if (zones.has(zone)) zones.delete(zone); else zones.add(zone);
        updateSvcPPF(serviceId, { ppf_zones: Array.from(zones) });
    };
    const addPpfPart = (serviceId, part) => {
        const p = (part || '').trim();
        if (!p) return;
        const svc = selectedServices.find(s => s.serviceId === serviceId);
        const parts = svc?.ppf_parts || [];
        if (parts.some(x => x.toLowerCase() === p.toLowerCase())) {
            setPpfPartInputs(prev => ({ ...prev, [serviceId]: '' }));
            return;
        }
        // Capitaliza la primera letra
        const label = p.charAt(0).toUpperCase() + p.slice(1);
        updateSvcPPF(serviceId, { ppf_parts: [...parts, label] });
        setPpfPartInputs(prev => ({ ...prev, [serviceId]: '' }));
    };
    const removePpfPart = (serviceId, part) => {
        const svc = selectedServices.find(s => s.serviceId === serviceId);
        updateSvcPPF(serviceId, { ppf_parts: (svc?.ppf_parts || []).filter(x => x !== part) });
    };
    const getPpfPartSuggestions = (serviceId) => {
        const q = (ppfPartInputs[serviceId] || '').trim().toLowerCase();
        const svc = selectedServices.find(s => s.serviceId === serviceId);
        const selected = (svc?.ppf_parts || []).map(x => x.toLowerCase());
        const base = PPF_PARTS.filter(p => !selected.includes(p.toLowerCase()));
        if (!q) return base.slice(0, 8);
        return base.filter(p => p.toLowerCase().includes(q)).slice(0, 8);
    };

    // Calculate total (IVA 19% si aplica factura). El recargo por tarjeta fue removido por decisión de negocio.
    const calculateBreakdown = () => {
        const subtotal = selectedServices.reduce((sum, svc) => sum + (svc.price || 0), 0);
        const extras = applicableExtras();
        if (sunroof.enabled) extras.push({ id: SUNROOF_ID, nombre: 'Sunroof (adicional)', price: sunroofPrice() });
        const extrasSum = extras.reduce((s, e) => s + (e.price || 0), 0);
        const baseSurcharge = subtotal + extrasSum;
        const cardSurcharge = 0; // ← eliminado 5% tarjeta
        // Aplicar descuento antes de IVA (descuento sobre subtotal+extras)
        let discountAmount = 0;
        if (discountApplied) {
            if (discountApplied.discount_type === 'percentage') {
                discountAmount = Math.round(baseSurcharge * (parseFloat(discountApplied.discount_value) || 0) / 100);
            } else {
                discountAmount = Math.round(parseFloat(discountApplied.discount_value) || 0);
            }
            if (discountAmount > baseSurcharge) discountAmount = baseSurcharge;
        }
        const baseTax = Math.max(baseSurcharge - discountAmount, 0);
        const iva = requiresInvoice ? Math.round(baseTax * 0.19) : 0;
        const total = baseTax + iva;
        return { subtotal, extras, extrasSum, cardSurcharge, discountAmount, iva, total };
    };
    const calculateTotal = () => calculateBreakdown().total;

    // Validar código de descuento (solo si la orden no tiene uno aplicado)
    const handleValidateDiscount = async () => {
        if (order?.discount_code) {
            toast.error('Esta orden ya tiene un código aplicado desde el agendamiento');
            return;
        }
        const code = (discountCodeInput || '').trim();
        if (!code) {
            toast.error('Ingresa un código de descuento');
            return;
        }
        const bk = (() => {
            const b = calculateBreakdown();
            return b.subtotal + b.extrasSum;
        })();
        if (bk <= 0) {
            toast.error('Agrega al menos un servicio antes de validar el código');
            return;
        }
        setValidatingDiscount(true);
        try {
            const res = await discountCodesAPI.validate(code, bk);
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
        setDiscountCodeInput('');
    };

    // Check if any selected service is polarizado/ultrasecure
    const hasPolarizadoService = () => {
        const polarizadoServices = [
            'nanooptik', 'black_ceramic_autobahn', 'ultraoptik_aswf', 
            'ceramic_i3_autobahn', 'ceramic_i3_plus_autobahn', 'huperoptik',
            'mixto', 'micras_300', 'micras_500', 'micras_700', 'micras_1000', 'micras_1700'
        ];
        return selectedServices.some(s => polarizadoServices.includes(s.serviceId) || 
            ['Polarizado/Ultrasecure', 'Polarizado', 'Ultrasecure'].includes(s.category));
    };

    // Get relevant risk checks based on services
    const getRelevantRiskChecks = () => {
        if (hasPolarizadoService()) {
            return ['retiroPolarizado', 'vidriosBlinados', 'instalacionEncima'];
        }
        return ['autorizaciones', 'datosPersonales'];
    };

    // Check if all relevant risk checks are complete
    const allRiskChecksComplete = () => {
        const relevantChecks = getRelevantRiskChecks();
        return relevantChecks.every(check => riskChecks[check]);
    };

    // Handle risk agreement acceptance
    const handleAcceptRiskAgreement = () => {
        if (!allRiskChecksComplete()) {
            toast.error('Debe aceptar todos los puntos del acuerdo');
            return;
        }
        setRiskAgreementAccepted(true);
        setShowRiskAgreement(false);
        toast.success('Acuerdo de riesgo aceptado');
    };

    // Submit ingreso approval
    const handleSubmit = async () => {
        if (selectedServices.length === 0) {
            toast.error('Debe tener al menos un servicio');
            return;
        }
        
        const total = calculateTotal();
        // En postventa el total puede ser $0 (servicios sin pago)
        if (total <= 0 && !order?.is_postventa) {
            toast.error('Ingresa el valor de al menos un servicio');
            return;
        }
        if (sunroof.enabled && (sunroof.price === '' || !(parseFloat(sunroof.price) >= 0))) {
            toast.error('Ingresa el valor del sunroof adicional');
            return;
        }
        if (!cedulaNumber) {
            toast.error('El número de cédula es requerido');
            return;
        }
        if (!profilePhoto) {
            toast.error('La foto frontal del vehículo es requerida');
            return;
        }
        if (!riskAgreementAccepted) {
            toast.error('Debe aceptar el acuerdo de riesgo de servicio');
            setShowRiskAgreement(true);
            return;
        }

        setConfirmIngresoOpen(true);
    };

    // Se ejecuta después de que el cliente confirma la orden y los avisos (2 veces)
    const submitIngreso = async (clientSignature) => {
        const total = calculateTotal();
        setSignature(clientSignature);
        setLoading(true);
        try {
            const bk = calculateBreakdown();
            // Enviar valor BRUTO (sin descuento) y dejar que backend aplique el descuento
            const subtotalGross = selectedServices.reduce((sum, svc) => sum + (svc.price || 0), 0);
            const extrasGross = bk.extras.reduce((s, e) => s + (e.price || 0), 0);
            const baseGross = subtotalGross + extrasGross;
            const ivaGross = requiresInvoice ? Math.round(baseGross * 0.19) : 0;
            const grossFinalValue = baseGross + ivaGross;
            const servicesData = selectedServices.map(svc => {
                const ppfDesc = isPPFService(svc) ? (
                    svc.ppf_scope === 'full'
                        ? `Full Body · ${svc.ppf_finish ? svc.ppf_finish.charAt(0).toUpperCase() + svc.ppf_finish.slice(1) : ''}${svc.ppf_color ? ` · Color: ${svc.ppf_color}` : ''}`
                        : svc.ppf_scope === 'partes'
                            ? `Partes (${(svc.ppf_zones || []).map(z => z.charAt(0).toUpperCase() + z.slice(1)).join(' + ') || 'sin zona'}) · ${svc.ppf_finish ? svc.ppf_finish.charAt(0).toUpperCase() + svc.ppf_finish.slice(1) : ''}${svc.ppf_color ? ` · Color: ${svc.ppf_color}` : ''} · ${(svc.ppf_parts || []).join(', ')}`
                            : null
                ) : null;
                return {
                    service: svc.serviceId,
                    price: svc.no_charge ? 0 : svc.price,
                    no_charge: order.is_postventa ? !!svc.no_charge : null,
                    description: `${svc.category} - ${svc.serviceName}`,
                    parts: svc.parts || [],
                    part_percentages: svc.part_percentages || {},
                    ppf_scope: svc.ppf_scope || null,
                    ppf_parts_description: ppfDesc,
                    ppf_finish: isPPFService(svc) ? (svc.ppf_finish || null) : null,
                    ppf_color: isPPFService(svc) ? (svc.ppf_color || null) : null,
                    ppf_zones: isPPFService(svc) ? (svc.ppf_zones || []) : null,
                    ppf_parts: isPPFService(svc) ? (svc.ppf_parts || []) : null,
                    extras: isPPFService(svc) || svc.parts?.some(p => bk.extras.find(e => e.trigger_part === p))
                        ? bk.extras.filter(e => svc.parts?.includes(e.trigger_part)).map(e => ({ id: e.id, nombre: e.nombre, price: e.price }))
                        : null,
                };
            });
            const sunroofData = sunroofLine();
            if (sunroofData) servicesData.push(sunroofData);

            // PDF de la orden con la firma del cliente: se envía al correo y queda archivado
            const pdfOrder = {
                ...order,
                services: servicesData,
                negotiated_value: total,
                client_id_number: cedulaNumber || order.client_id_number,
                signature_url: clientSignature,
            };
            let orderPdf = null;
            try {
                orderPdf = await generateOrderPDF(pdfOrder, { download: false });
            } catch (pdfErr) {
                console.error('Error generando PDF:', pdfErr);
            }

            await ordersAPI.approveIngreso({
                order_id: order.id,
                order_pdf: orderPdf,
                services: servicesData,
                final_value: grossFinalValue,
                signature_url: clientSignature,
                cedula_number: cedulaNumber,
                risk_agreement_accepted: riskAgreementAccepted,
                profile_photo_url: profilePhoto,
                payment_method: paymentMethod,
                requires_invoice: requiresInvoice,
                discount_code: (discountApplied && !discountApplied.from_appointment) ? discountApplied.code : null,
            });

            toast.success('Ingreso aprobado exitosamente');

            // Descargar también la orden firmada en este equipo
            if (orderPdf) {
                const link = document.createElement('a');
                link.href = orderPdf;
                link.download = `Orden_${order.order_code || 'pedido'}_${order.plate || ''}.pdf`;
                link.click();
                toast.success('Orden firmada descargada');
            } else {
                toast.error('No se pudo generar el PDF de la orden');
            }

            // Continúa al paso de Revisión 360° dentro del mismo wizard
            setStep('inspection');
        } catch (error) {
            toast.error(error.response?.data?.detail || 'Error al procesar el ingreso');
        } finally {
            setLoading(false);
        }
    };

    // Send inspection photos to client by email
    const handleSendPhotosEmail = async () => {
        if (!order?.id) return;
        setSendingPhotos(true);
        try {
            const res = await ordersAPI.sendInspectionPhotos(order.id);
            const count = res.data?.recipients?.length || 0;
            toast.success(`Fotos enviadas a ${count} destinatario(s)`);
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error al enviar las fotos por correo');
        } finally {
            setSendingPhotos(false);
        }
    };

    // Reset form
    const resetForm = () => {
        setStep(1);
        setOrderCode('');
        setOrder(null);
        setSelectedServices([]);
        setSunroof({ enabled: false, price: '', percentage: '' });
        setSignature(null);
        setCedulaNumber('');
        setProfilePhoto(null);
        setInspectionPhotosCount(0);
        setSendingPhotos(false);
        setPaymentMethod('efectivo');
        setRequiresInvoice(false);
        setWaitingInfo(null);
        setRiskAgreementAccepted(false);
        setCustomServiceName('');
        setCustomServicePrice('');
        setRiskChecks({
            retiroPolarizado: false,
            vidriosBlinados: false,
            instalacionEncima: false,
            autorizaciones: false,
            porcentajes: false,
            datosPersonales: false
        });
    };

    return (
        <div className="space-y-6" data-testid="checkin-page">
            <CheckinConfirmDialog
                open={confirmIngresoOpen}
                onOpenChange={setConfirmIngresoOpen}
                order={order}
                services={selectedServices}
                breakdown={confirmIngresoOpen ? calculateBreakdown() : {}}
                paymentMethod={paymentMethod}
                requiresInvoice={requiresInvoice}
                onConfirm={submitIngreso}
            />

            {/* Risk Agreement Modal - Styled Content */}
            <Dialog open={showRiskAgreement} onOpenChange={setShowRiskAgreement}>
                <DialogContent className="max-w-3xl max-h-[90vh]">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-xl flex items-center gap-2">
                            <Shield className="w-6 h-6 text-cyan-400" />
                            Acuerdo de Riesgo de Servicio
                        </DialogTitle>
                        <DialogDescription>
                            {hasPolarizadoService() 
                                ? 'Acuerdo específico para servicios de Polarizado/Ultrasecure'
                                : 'Acuerdo general de servicio'
                            }
                        </DialogDescription>
                    </DialogHeader>
                    <ScrollArea className="h-[55vh] pr-4">
                        <div className="space-y-4">
                            {/* Header del documento */}
                            <div className="text-center p-4 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 rounded-lg border border-cyan-500/30">
                                <h3 className="font-heading text-lg text-cyan-400">POLARIZADOS MANAGER</h3>
                                <p className="text-sm text-muted-foreground">Términos y Condiciones del Servicio</p>
                            </div>

                            {/* Notas para Polarizado/Ultrasecure */}
                            {hasPolarizadoService() && (
                                <>
                                    {/* Sección 1: Retiro de Polarizado */}
                                    <div className={`p-4 rounded-lg border transition-all ${riskChecks.retiroPolarizado ? 'border-green-500/50 bg-green-500/5' : 'border-border'}`}>
                                        <div className="flex items-start gap-3">
                                            <Checkbox
                                                id="check-retiro"
                                                checked={riskChecks.retiroPolarizado}
                                                onCheckedChange={(checked) => setRiskChecks(prev => ({...prev, retiroPolarizado: checked}))}
                                                className="mt-1"
                                            />
                                            <div className="flex-1">
                                                <label htmlFor="check-retiro" className="font-medium cursor-pointer text-cyan-400">
                                                    Nota para Retiro de Polarizado en Vidrio Trasero
                                                </label>
                                                <p className="text-sm text-muted-foreground mt-1">
                                                    Cliente autoriza el retiro del polarizado del vidrio trasero, entendiendo y aceptando que este 
                                                    procedimiento puede implicar riesgos técnicos, como el deterioro o daño parcial del sistema 
                                                    acompañante de dicho vidrio. <span className="text-yellow-500 font-medium">ACEPTO</span>
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Sección 2: Vidrios Blindados */}
                                    <div className={`p-4 rounded-lg border transition-all ${riskChecks.vidriosBlinados ? 'border-green-500/50 bg-green-500/5' : 'border-border'}`}>
                                        <div className="flex items-start gap-3">
                                            <Checkbox
                                                id="check-blindados"
                                                checked={riskChecks.vidriosBlinados}
                                                onCheckedChange={(checked) => setRiskChecks(prev => ({...prev, vidriosBlinados: checked}))}
                                                className="mt-1"
                                            />
                                            <div className="flex-1">
                                                <label htmlFor="check-blindados" className="font-medium cursor-pointer text-cyan-400">
                                                    Nota para Retiro en Vidrios Blindados
                                                </label>
                                                <p className="text-sm text-muted-foreground mt-1">
                                                    Cliente autoriza el retiro del polarizado aplicado sobre vidrios blindados, reconociendo que, 
                                                    debido a la naturaleza del policarbonato, existe la posibilidad de que queden marcas, 
                                                    mapeos o alteraciones visuales en la superficie del blindaje. <span className="text-yellow-500 font-medium">ACEPTO</span>
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Sección 3: Instalación Encima */}
                                    <div className={`p-4 rounded-lg border transition-all ${riskChecks.instalacionEncima ? 'border-green-500/50 bg-green-500/5' : 'border-border'}`}>
                                        <div className="flex items-start gap-3">
                                            <Checkbox
                                                id="check-encima"
                                                checked={riskChecks.instalacionEncima}
                                                onCheckedChange={(checked) => setRiskChecks(prev => ({...prev, instalacionEncima: checked}))}
                                                className="mt-1"
                                            />
                                            <div className="flex-1">
                                                <label htmlFor="check-encima" className="font-medium cursor-pointer text-cyan-400">
                                                    Nota para Instalación Encima de Material Actual
                                                </label>
                                                <p className="text-sm text-muted-foreground mt-1">
                                                    Cliente autoriza la instalación del panorámico trasero sobre el material previamente instalado, 
                                                    reconociendo que las impurezas, destellos e imperfecciones existentes en dicho material podrían 
                                                    volverse más evidentes tras la instalación. <span className="text-yellow-500 font-medium">ACEPTO</span>
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}

                            {/* Notas generales para otros servicios */}
                            {!hasPolarizadoService() && (
                                <>
                                    {/* Sección: Autorizaciones */}
                                    <div className={`p-4 rounded-lg border transition-all ${riskChecks.autorizaciones ? 'border-green-500/50 bg-green-500/5' : 'border-border'}`}>
                                        <div className="flex items-start gap-3">
                                            <Checkbox
                                                id="check-autorizaciones"
                                                checked={riskChecks.autorizaciones}
                                                onCheckedChange={(checked) => setRiskChecks(prev => ({...prev, autorizaciones: checked}))}
                                                className="mt-1"
                                            />
                                            <div className="flex-1">
                                                <label htmlFor="check-autorizaciones" className="font-medium cursor-pointer text-cyan-400">
                                                    Autorizaciones Generales
                                                </label>
                                                <p className="text-sm text-muted-foreground mt-1">
                                                    Autorizo a POLARIZADOS MANAGER para que instale los productos acordados en esta orden de pedido, 
                                                    así mismo los autorizo para que una vez terminada la instalación, pueda probar el vehículo 
                                                    dentro del circuito que se tenga fijado. POLARIZADOS MANAGER no responde por la pérdida 
                                                    de objetos o bienes si estos no han sido reportados.
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Sección: Datos Personales */}
                                    <div className={`p-4 rounded-lg border transition-all ${riskChecks.datosPersonales ? 'border-green-500/50 bg-green-500/5' : 'border-border'}`}>
                                        <div className="flex items-start gap-3">
                                            <Checkbox
                                                id="check-datos"
                                                checked={riskChecks.datosPersonales}
                                                onCheckedChange={(checked) => setRiskChecks(prev => ({...prev, datosPersonales: checked}))}
                                                className="mt-1"
                                            />
                                            <div className="flex-1">
                                                <label htmlFor="check-datos" className="font-medium cursor-pointer text-cyan-400">
                                                    Tratamiento de Datos Personales
                                                </label>
                                                <p className="text-sm text-muted-foreground mt-1">
                                                    El uso de la información suministrada a POLARIZADOS MANAGER está limitada a fines privados 
                                                    y amparados por la Ley 1581 de 2012 (protección de datos) y Ley 1480 de 2011 
                                                    (protección al consumidor).
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}

                            {/* Footer del documento */}
                            <div className="p-4 bg-muted/30 rounded-lg border text-center text-sm text-muted-foreground italic">
                                "La bendición de Jehová es la que enriquece, y no añade tristeza" - Proverbios 10:22
                            </div>
                        </div>
                    </ScrollArea>
                    
                    {/* Progress indicator */}
                    <div className="pt-4 border-t">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-sm text-muted-foreground">
                                Puntos aceptados: {getRelevantRiskChecks().filter(check => riskChecks[check]).length} de {getRelevantRiskChecks().length}
                            </span>
                            <div className="flex gap-1">
                                {getRelevantRiskChecks().map((check, i) => (
                                    <div 
                                        key={i} 
                                        className={`w-3 h-3 rounded-full transition-colors ${riskChecks[check] ? 'bg-green-500' : 'bg-muted'}`}
                                    />
                                ))}
                            </div>
                        </div>
                        <div className="flex gap-3">
                            <Button 
                                variant="outline" 
                                onClick={() => setShowRiskAgreement(false)}
                                className="flex-1"
                            >
                                Cancelar
                            </Button>
                            <Button 
                                onClick={handleAcceptRiskAgreement}
                                className="flex-1 brand-glow"
                                disabled={!allRiskChecksComplete()}
                                data-testid="accept-risk-btn"
                            >
                                <CheckCircle className="w-4 h-4 mr-2" />
                                Aceptar Acuerdo
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl">Check-in / Ingreso</h1>
                    <p className="text-muted-foreground">
                        Escanea el QR o ingresa el código de la cita
                    </p>
                </div>
                {step > 1 && (
                    <Button variant="outline" onClick={resetForm}>
                        Nueva Búsqueda
                    </Button>
                )}
            </div>

            {/* Progress Steps */}
            <div className="flex items-center justify-center gap-2">
                {[1, 2, 3].map((s) => (
                    <div key={s} className="flex items-center">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                            step >= s 
                                ? 'bg-primary text-primary-foreground' 
                                : 'bg-muted text-muted-foreground'
                        }`}>
                            {step > s ? <CheckCircle className="w-4 h-4" /> : s}
                        </div>
                        {s < 3 && (
                            <div className={`w-12 h-1 mx-1 rounded ${
                                step > s ? 'bg-primary' : 'bg-muted'
                            }`} />
                        )}
                    </div>
                ))}
            </div>

            {/* Step 1: Scan QR or Enter Code */}
            {step === 1 && (
                <div className="grid lg:grid-cols-2 gap-6">
                    {/* Waiting Card */}
                    {waitingInfo && (
                        <Card className={`lg:col-span-2 ${waitingInfo.alreadyCheckedIn ? 'border-red-500/50 bg-red-500/10' : 'border-yellow-500/50 bg-yellow-500/10'}`}>
                            <CardContent className="pt-6">
                                <div className="flex flex-col items-center text-center space-y-4">
                                    {waitingInfo.alreadyCheckedIn ? (
                                        <>
                                            <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center">
                                                <CheckCircle className="w-10 h-10 text-red-500" />
                                            </div>
                                            <div>
                                                <h3 className="font-heading text-2xl text-red-500 flex items-center justify-center gap-2">
                                                    <AlertTriangle className="w-6 h-6" />
                                                    Esta orden ya fue ingresada
                                                </h3>
                                                <p className="text-muted-foreground mt-2">No se puede repetir el check-in.</p>

                                                <div className="mt-4 p-4 rounded-lg bg-card border space-y-2 text-left">
                                                    {waitingInfo.plate && (
                                                        <div className="flex justify-between">
                                                            <span className="text-sm text-muted-foreground">Placa:</span>
                                                            <span className="font-mono font-bold">{waitingInfo.plate}</span>
                                                        </div>
                                                    )}
                                                    {waitingInfo.orderCode && (
                                                        <div className="flex justify-between">
                                                            <span className="text-sm text-muted-foreground">Código:</span>
                                                            <span className="font-mono">{waitingInfo.orderCode}</span>
                                                        </div>
                                                    )}
                                                    {waitingInfo.clientName && (
                                                        <div className="flex justify-between">
                                                            <span className="text-sm text-muted-foreground">Cliente:</span>
                                                            <span>{waitingInfo.clientName}</span>
                                                        </div>
                                                    )}
                                                    {waitingInfo.currentStatusLabel && (
                                                        <div className="flex justify-between">
                                                            <span className="text-sm text-muted-foreground">Estado actual:</span>
                                                            <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-xs font-medium">{waitingInfo.currentStatusLabel}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <Button variant="outline" onClick={() => setWaitingInfo(null)} data-testid="search-another-btn">
                                                Buscar otra orden
                                            </Button>
                                        </>
                                    ) : (
                                        <>
                                            <div className="w-20 h-20 rounded-full bg-yellow-500/20 flex items-center justify-center">
                                                <Timer className="w-10 h-10 text-yellow-500 animate-pulse" />
                                            </div>
                                            <div>
                                                <h3 className="font-heading text-2xl text-yellow-500 flex items-center justify-center gap-2">
                                                    <AlertTriangle className="w-6 h-6" />
                                                    Debe Esperar
                                                </h3>
                                                
                                                {/* Hora de la cita */}
                                                {waitingInfo.scheduledTime && (
                                                    <div className="mt-4 p-4 rounded-lg bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/40">
                                                        <p className="text-sm text-muted-foreground">Su cita es a las:</p>
                                                        <p className="text-4xl font-mono font-bold text-cyan-400 mt-1">
                                                            {waitingInfo.scheduledTime}
                                                        </p>
                                                    </div>
                                                )}
                                                
                                                {/* Tiempo restante */}
                                                {waitingInfo.timeRemaining && (
                                                    <div className="mt-4 p-4 rounded-lg bg-card border">
                                                        <p className="text-sm text-muted-foreground">Tiempo restante para check-in:</p>
                                                        <p className="text-3xl font-mono font-bold text-primary mt-1">
                                                            {waitingInfo.timeRemaining}
                                                        </p>
                                                    </div>
                                                )}
                                                
                                                <p className="text-sm text-muted-foreground mt-4">
                                                    Fecha: {waitingInfo.appointmentDate}
                                                </p>
                                            </div>
                                            <Button variant="outline" onClick={() => setWaitingInfo(null)}>
                                                Buscar otra orden
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Colombia Time */}
                    {colombiaTime && !waitingInfo && (
                        <div className="lg:col-span-2 flex justify-center">
                            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted/50 text-sm">
                                <Clock className="w-4 h-4 text-primary" />
                                <span className="text-muted-foreground">Hora Colombia:</span>
                                <span className="font-mono font-medium">{colombiaTime.formatted}</span>
                            </div>
                        </div>
                    )}

                    {!waitingInfo && (
                        <>
                            <Tabs defaultValue={PREFERS_SCAN ? 'scan' : 'code'} className="w-full">
                                <TabsList className="grid w-full grid-cols-2">
                                    <TabsTrigger value="scan" data-testid="scan-tab">
                                        <QrCode className="w-4 h-4 mr-2" />
                                        Escanear QR
                                    </TabsTrigger>
                                    <TabsTrigger value="code" data-testid="code-tab">
                                        <Search className="w-4 h-4 mr-2" />
                                        Ingresar Código
                                    </TabsTrigger>
                                </TabsList>
                                <TabsContent value="scan" className="mt-4">
                                    <QRScanner onScan={handleQRScan} autoStart />
                                </TabsContent>
                                <TabsContent value="code" className="mt-4">
                                    <Card>
                                        <CardHeader>
                                            <CardTitle className="font-heading text-lg">Buscar por Código o Placa</CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <div className="space-y-2">
                                                <Label>Código de Cita o Placa del Vehículo</Label>
                                                <Input
                                                    value={orderCode}
                                                    onChange={(e) => setOrderCode(e.target.value.toUpperCase())}
                                                    placeholder="Ej: ABC12345  o  XYZ123"
                                                    className="font-mono text-lg"
                                                    data-testid="order-code-input"
                                                />
                                                <p className="text-xs text-muted-foreground">
                                                    Ingresa el código de la cita o la placa del vehículo.
                                                </p>
                                            </div>
                                            <Button 
                                                onClick={() => searchOrder(orderCode)}
                                                className="w-full"
                                                disabled={loading}
                                                data-testid="search-order-btn"
                                            >
                                                {loading ? (
                                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                                                ) : (
                                                    <Search className="w-4 h-4 mr-2" />
                                                )}
                                                Buscar Orden
                                            </Button>
                                        </CardContent>
                                    </Card>
                                </TabsContent>
                            </Tabs>

                            <Card className="card-hover">
                                <CardHeader>
                                    <CardTitle className="font-heading text-lg flex items-center gap-2">
                                        <FileCheck className="w-5 h-5 text-primary" />
                                        Instrucciones
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-3">
                                        <div className="flex items-start gap-3">
                                            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium shrink-0">1</div>
                                            <p className="text-sm">Escanea el QR, ingresa el código de la cita, o busca por placa</p>
                                        </div>
                                        <div className="flex items-start gap-3">
                                            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium shrink-0">2</div>
                                            <p className="text-sm">Agrega servicios adicionales si el cliente lo desea</p>
                                        </div>
                                        <div className="flex items-start gap-3">
                                            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium shrink-0">3</div>
                                            <p className="text-sm">El cliente debe aceptar el acuerdo de riesgo</p>
                                        </div>
                                        <div className="flex items-start gap-3">
                                            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium shrink-0">4</div>
                                            <p className="text-sm">Captura la firma digital y número de cédula</p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </>
                    )}
                </div>
            )}

            {/* Step 2: Verify, Upsell, and Approve */}
            {step === 2 && order && (
                <div className="grid lg:grid-cols-2 gap-6">
                    {/* Order Info */}
                    <Card className="card-hover">
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <CardTitle className="font-heading text-lg flex items-center gap-2">
                                    <Car className="w-5 h-5 text-primary" />
                                    Datos de la Cita
                                </CardTitle>
                                <div className="flex items-center gap-2 shrink-0">
                                    <PostventaBadge order={order} />
                                    <OrderStatusBadge status={order.status} />
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="p-4 rounded-lg bg-muted/50 space-y-3">
                                <div className="flex items-center gap-2">
                                    <User className="w-4 h-4 text-muted-foreground" />
                                    <span className="font-medium">{order.client_name}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Phone className="w-4 h-4 text-muted-foreground" />
                                    <span>{order.client_phone}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Car className="w-4 h-4 text-muted-foreground" />
                                    <span className="font-mono">{order.plate}</span>
                                    <span className="text-muted-foreground">- {order.brand} {order.model}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <QrCode className="w-4 h-4 text-muted-foreground" />
                                    <span className="font-mono text-primary">{order.order_code}</span>
                                </div>
                            </div>
                            {order.qr_code && (
                                <QRDisplay 
                                    qrCode={order.qr_code}
                                    orderCode={order.order_code}
                                    clientName={order.client_name}
                                />
                            )}
                        </CardContent>
                    </Card>

                    {/* Services - Upsell */}
                    <Card className="card-hover">
                        <CardHeader>
                            <CardTitle className="font-heading text-lg flex items-center gap-2">
                                <Package className="w-5 h-5 text-primary" />
                                Servicios (Agregar más)
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Current Selected Services */}
                            {selectedServices.length > 0 && (
                                <div className="space-y-2">
                                    <Label>Servicios Seleccionados</Label>
                                    <div className="space-y-2">
                                        {selectedServices.map((svc) => (
                                            <div key={svc.serviceId} className="p-3 rounded-lg bg-primary/10 border border-primary/30">
                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2">
                                                            {svc.isCustom && (
                                                                <span className="text-xs bg-yellow-500/20 text-yellow-500 px-1.5 py-0.5 rounded">
                                                                    Personalizado
                                                                </span>
                                                            )}
                                                            <p className="font-medium text-sm">{svc.serviceName}</p>
                                                        </div>
                                                        <p className="text-xs text-muted-foreground">{svc.category}</p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {order?.is_postventa && (
                                                            <label className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded border cursor-pointer whitespace-nowrap ${svc.no_charge ? 'bg-amber-500/15 border-amber-500/50 text-amber-500 font-medium' : 'border-input text-muted-foreground'}`}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={!!svc.no_charge}
                                                                    onChange={(e) => handleServiceNoChargeToggle(svc.serviceId, e.target.checked)}
                                                                    className="w-4 h-4 accent-amber-500"
                                                                    data-testid={`checkin-nocharge-${svc.serviceId}`}
                                                                />
                                                                Sin pago
                                                            </label>
                                                        )}
                                                        <span className="text-sm">$</span>
                                                        <Input
                                                            type="number"
                                                            min="0"
                                                            value={svc.no_charge ? 0 : (svc.price || '')}
                                                            onChange={(e) => handleServicePriceChange(svc.serviceId, e.target.value)}
                                                            disabled={!!svc.no_charge}
                                                            className="w-28 h-8 text-right"
                                                            placeholder="Valor"
                                                        />
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-red-500 hover:text-red-600"
                                                            onClick={() => handleRemoveService(svc.serviceId)}
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                </div>
                                                {/* PPF: Full Body o Partes */}
                                                {isPPFService(svc) && (
                                                    <div className="mt-3 pt-3 border-t border-border/50 space-y-3 bg-blue-500/5 -mx-3 -mb-3 px-3 pb-3 rounded-b-lg" data-testid={`ppf-block-${svc.serviceId}`}>
                                                        <p className="text-xs font-medium text-blue-300 flex items-center gap-1">
                                                            <Package className="w-3 h-3" />
                                                            PPF — Alcance del servicio
                                                        </p>
                                                        {/* Plan: si el servicio ya define el plan (catálogo nuevo), mostrar etiqueta fija */}
                                                        {(svc.serviceId === 'ppf_full_body' || svc.serviceId === 'ppf_partes') ? (
                                                            <p className="text-xs text-blue-200" data-testid={`ppf-plan-label-${svc.serviceId}`}>
                                                                Plan: <b>{svc.serviceId === 'ppf_full_body' ? 'Full Body' : 'Partes / Piezas'}</b>
                                                            </p>
                                                        ) : (
                                                            <div className="grid grid-cols-2 gap-1">
                                                                {[
                                                                    { value: 'full', label: 'Full Body' },
                                                                    { value: 'partes', label: 'Partes / Piezas' },
                                                                ].map(opt => (
                                                                    <button
                                                                        key={opt.value}
                                                                        type="button"
                                                                        onClick={() => handlePpfScopeChange(svc.serviceId, opt.value)}
                                                                        className={`text-xs px-2 py-1.5 rounded border transition-colors ${
                                                                            svc.ppf_scope === opt.value
                                                                                ? 'bg-blue-500/25 border-blue-500/60 text-blue-200 font-medium'
                                                                                : 'border-input hover:border-blue-500/40 text-muted-foreground'
                                                                        }`}
                                                                        data-testid={`ppf-scope-${svc.serviceId}-${opt.value}`}
                                                                    >
                                                                        {opt.label}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {/* Acabado + Color (ambos planes) */}
                                                        {svc.ppf_scope && (
                                                            <div className="space-y-2">
                                                                <p className="text-[11px] text-blue-200/80">Acabado</p>
                                                                <div className="grid grid-cols-2 gap-1">
                                                                    {[
                                                                        { value: 'brillante', label: 'Brillante' },
                                                                        { value: 'mate', label: 'Mate' },
                                                                    ].map(opt => (
                                                                        <button
                                                                            key={opt.value}
                                                                            type="button"
                                                                            onClick={() => updateSvcPPF(svc.serviceId, { ppf_finish: opt.value })}
                                                                            className={`text-xs px-2 py-1.5 rounded border transition-colors ${
                                                                                svc.ppf_finish === opt.value
                                                                                    ? 'bg-blue-500/25 border-blue-500/60 text-blue-200 font-medium'
                                                                                    : 'border-input hover:border-blue-500/40 text-muted-foreground'
                                                                            }`}
                                                                            data-testid={`ppf-finish-${svc.serviceId}-${opt.value}`}
                                                                        >
                                                                            {opt.label}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                                <Input
                                                                    value={svc.ppf_color || ''}
                                                                    onChange={(e) => updateSvcPPF(svc.serviceId, { ppf_color: e.target.value })}
                                                                    placeholder="Escribe el color (Ej: Negro, Gris Nardo, Rojo...)"
                                                                    className="h-8 text-xs"
                                                                    data-testid={`ppf-color-${svc.serviceId}`}
                                                                />
                                                            </div>
                                                        )}

                                                        {/* Zonas + Partes (solo plan partes) */}
                                                        {svc.ppf_scope === 'partes' && (
                                                            <div className="space-y-2">
                                                                <p className="text-[11px] text-blue-200/80">Zona</p>
                                                                <div className="grid grid-cols-2 gap-1">
                                                                    {[
                                                                        { value: 'interior', label: 'Interior' },
                                                                        { value: 'exterior', label: 'Exterior' },
                                                                    ].map(opt => {
                                                                        const active = (svc.ppf_zones || []).includes(opt.value);
                                                                        return (
                                                                            <button
                                                                                key={opt.value}
                                                                                type="button"
                                                                                onClick={() => togglePpfZone(svc.serviceId, opt.value)}
                                                                                className={`text-xs px-2 py-1.5 rounded border transition-colors ${
                                                                                    active
                                                                                        ? 'bg-blue-500/25 border-blue-500/60 text-blue-200 font-medium'
                                                                                        : 'border-input hover:border-blue-500/40 text-muted-foreground'
                                                                                }`}
                                                                                data-testid={`ppf-zone-${svc.serviceId}-${opt.value}`}
                                                                            >
                                                                                {opt.label}
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>

                                                                <p className="text-[11px] text-blue-200/80">Partes</p>
                                                                {/* Chips de partes seleccionadas */}
                                                                {(svc.ppf_parts || []).length > 0 && (
                                                                    <div className="flex flex-wrap gap-1" data-testid={`ppf-parts-chips-${svc.serviceId}`}>
                                                                        {(svc.ppf_parts || []).map(part => (
                                                                            <span key={part} className="inline-flex items-center gap-1 text-xs bg-blue-500/20 text-blue-200 border border-blue-500/40 px-2 py-0.5 rounded">
                                                                                {part}
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => removePpfPart(svc.serviceId, part)}
                                                                                    className="text-blue-300 hover:text-red-400"
                                                                                    data-testid={`ppf-part-remove-${svc.serviceId}-${part}`}
                                                                                >
                                                                                    ×
                                                                                </button>
                                                                            </span>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                                {/* Selector predictivo */}
                                                                <div className="relative">
                                                                    <Input
                                                                        value={ppfPartInputs[svc.serviceId] || ''}
                                                                        onChange={(e) => setPpfPartInputs(prev => ({ ...prev, [svc.serviceId]: e.target.value }))}
                                                                        onKeyDown={(e) => {
                                                                            if (e.key === 'Enter') {
                                                                                e.preventDefault();
                                                                                addPpfPart(svc.serviceId, ppfPartInputs[svc.serviceId]);
                                                                            }
                                                                        }}
                                                                        placeholder="Escribe para buscar: bomper, capot, espejos..."
                                                                        className="h-8 text-xs"
                                                                        data-testid={`ppf-part-input-${svc.serviceId}`}
                                                                    />
                                                                    {getPpfPartSuggestions(svc.serviceId).length > 0 && (
                                                                        <div className="mt-1 flex flex-wrap gap-1" data-testid={`ppf-part-suggestions-${svc.serviceId}`}>
                                                                            {getPpfPartSuggestions(svc.serviceId).map(part => (
                                                                                <button
                                                                                    key={part}
                                                                                    type="button"
                                                                                    onClick={() => addPpfPart(svc.serviceId, part)}
                                                                                    className="text-[11px] px-2 py-0.5 rounded border border-input text-muted-foreground hover:border-blue-500/50 hover:text-blue-200 transition-colors"
                                                                                    data-testid={`ppf-part-suggestion-${svc.serviceId}-${part}`}
                                                                                >
                                                                                    + {part}
                                                                                </button>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                        <p className="text-[11px] text-muted-foreground">
                                                            Ajusta el precio del PPF arriba según lo negociado con el cliente.
                                                        </p>
                                                    </div>
                                                )}
                                                {/* Vehicle parts selection for polarizado services */}
                                                {serviceRequiresParts(svc.serviceId) && (
                                                    <div className="mt-3 pt-3 border-t border-border/50">
                                                        <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                                                            <Car className="w-3 h-3" />
                                                            Selecciona las partes del vehículo
                                                            {serviceRequiresPercentage(svc.serviceId) && (
                                                                <span className="text-amber-400">· Indica el % por parte</span>
                                                            )}:
                                                        </p>
                                                        <div className="space-y-2">
                                                            {SERVICE_PARTS.map((part) => {
                                                                const isPartSelected = svc.parts?.includes(part.id);
                                                                const showPct = serviceRequiresPercentage(svc.serviceId);
                                                                const pctValue = svc.part_percentages?.[part.id] || (isPartSelected ? '' : 'N/A');
                                                                return (
                                                                    <div
                                                                        key={part.id}
                                                                        className={`flex items-center gap-2 p-2 rounded transition-colors ${
                                                                            isPartSelected 
                                                                                ? 'bg-cyan-500/20 border border-cyan-500/40' 
                                                                                : 'bg-muted/30 border border-transparent'
                                                                        }`}
                                                                    >
                                                                        <div
                                                                            className="flex items-center gap-2 flex-1 cursor-pointer"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                handlePartToggle(svc.serviceId, part.id);
                                                                            }}
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
                                                                            <span className="text-xs select-none">{part.name}</span>
                                                                        </div>
                                                                        {showPct && (
                                                                            <select
                                                                                className="text-xs px-2 py-1 rounded border border-input bg-background"
                                                                                value={pctValue}
                                                                                onChange={(e) => {
                                                                                    const val = e.target.value;
                                                                                    setSelectedServices(prev => prev.map(s => {
                                                                                        if (s.serviceId !== svc.serviceId) return s;
                                                                                        const newPct = { ...(s.part_percentages || {}) };
                                                                                        if (val === 'N/A') {
                                                                                            delete newPct[part.id];
                                                                                        } else {
                                                                                            newPct[part.id] = val;
                                                                                        }
                                                                                        return { ...s, part_percentages: newPct };
                                                                                    }));
                                                                                }}
                                                                                disabled={!isPartSelected}
                                                                                data-testid={`pct-${svc.serviceId}-${part.id}`}
                                                                            >
                                                                                <option value="N/A">N/A</option>
                                                                                {TINT_PERCENTAGES.map(p => (
                                                                                    <option key={p} value={p}>{p}</option>
                                                                                ))}
                                                                            </select>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                        {svc.parts?.length > 0 && (
                                                            <p className="text-xs text-cyan-400 mt-2">
                                                                {svc.parts.length} parte(s) seleccionada(s)
                                                            </p>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Add More Services */}
                            <div className="space-y-2">
                                <Label className="flex items-center gap-2">
                                    <Plus className="w-4 h-4" />
                                    Agregar Servicios Adicionales
                                </Label>
                                <Accordion type="multiple" className="w-full">
                                    {Object.entries(serviceCatalog).map(([categoryId, category]) => (
                                        <AccordionItem key={categoryId} value={categoryId}>
                                            <AccordionTrigger className="hover:no-underline text-sm">
                                                <span>{category.name}</span>
                                            </AccordionTrigger>
                                            <AccordionContent>
                                                <div className="space-y-1 pt-2">
                                                    {category.services.map((service) => {
                                                        const isSelected = selectedServices.some(s => s.serviceId === service.id);
                                                        return (
                                                            <div
                                                                key={service.id}
                                                                className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                                                                    isSelected ? 'bg-primary/20 border border-primary/30' : 'hover:bg-muted/50 border border-transparent'
                                                                }`}
                                                                onClick={() => handleServiceToggle(service.id, service.name, category.name)}
                                                                data-testid={`checkin-service-${service.id}`}
                                                            >
                                                                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                                                                    isSelected 
                                                                        ? 'bg-primary border-primary' 
                                                                        : 'border-muted-foreground/50'
                                                                }`}>
                                                                    {isSelected && (
                                                                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                                        </svg>
                                                                    )}
                                                                </div>
                                                                <span className="text-sm flex-1"><ServiceCatalogLabel service={service} /></span>
                                                                {isSelected && <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </AccordionContent>
                                        </AccordionItem>
                                    ))}
                                </Accordion>
                            </div>

                            {/* Custom Service Input */}
                            <div className="p-4 rounded-lg border border-dashed border-muted-foreground/50 space-y-3">
                                <Label className="flex items-center gap-2 text-muted-foreground">
                                    <PlusCircle className="w-4 h-4" />
                                    Agregar Servicio/Producto Personalizado
                                </Label>
                                <div className="flex gap-2">
                                    <Input
                                        value={customServiceName}
                                        onChange={(e) => setCustomServiceName(e.target.value)}
                                        placeholder="Nombre del servicio o producto"
                                        className="flex-1"
                                        data-testid="custom-service-name"
                                    />
                                    <div className="flex items-center gap-1">
                                        <span className="text-sm text-muted-foreground">$</span>
                                        <Input
                                            type="number"
                                            min="0"
                                            value={customServicePrice}
                                            onChange={(e) => setCustomServicePrice(e.target.value)}
                                            placeholder="Valor"
                                            className="w-28"
                                            data-testid="custom-service-price"
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        onClick={handleAddCustomService}
                                        data-testid="add-custom-service-btn"
                                    >
                                        <Plus className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>

                            {/* Sunroof: siempre adicional, nunca dentro de un servicio */}
                            <div className={`p-3 rounded-lg border space-y-3 ${sunroof.enabled ? 'border-amber-500/50 bg-amber-500/10' : 'border-border bg-muted/30'}`} data-testid="sunroof-block">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={sunroof.enabled}
                                        onChange={(e) => {
                                            const on = e.target.checked;
                                            setSunroof(prev => ({ ...prev, enabled: on, price: on && prev.price === '' ? defaultSunroofPrice() : prev.price }));
                                        }}
                                        className="w-4 h-4 accent-amber-500"
                                        data-testid="sunroof-toggle"
                                    />
                                    <span className="text-sm font-medium">Sunroof (adicional)</span>
                                    <span className="text-xs text-muted-foreground">· no está incluido en ningún servicio</span>
                                </label>
                                {sunroof.enabled && (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                            <Label className="text-xs">Valor del sunroof *</Label>
                                            <div className="flex items-center gap-1">
                                                <span className="text-sm text-muted-foreground">$</span>
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    value={sunroof.price}
                                                    onChange={(e) => setSunroof(prev => ({ ...prev, price: e.target.value }))}
                                                    placeholder="Valor"
                                                    className="text-right font-mono"
                                                    data-testid="sunroof-price"
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">% de polarizado</Label>
                                            <select
                                                value={sunroof.percentage}
                                                onChange={(e) => setSunroof(prev => ({ ...prev, percentage: e.target.value }))}
                                                className="w-full h-9 text-sm px-2 rounded-md border border-input bg-background"
                                                data-testid="sunroof-percentage"
                                            >
                                                <option value="">Sin indicar</option>
                                                {TINT_PERCENTAGES.map(p => <option key={p} value={p}>{p}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Forma de pago + Factura electrónica */}
                            <div className="grid sm:grid-cols-2 gap-3">
                                <div className="p-3 rounded-lg border border-border bg-muted/30 space-y-2" data-testid="payment-method-block">
                                    <Label className="text-sm font-medium">Forma de pago *</Label>
                                    <div className={`grid gap-1 ${order?.is_postventa ? 'grid-cols-2' : 'grid-cols-3'}`}>
                                        {[
                                            { value: 'efectivo', label: 'Efectivo' },
                                            { value: 'tarjeta', label: 'Tarjeta' },
                                            { value: 'transferencia', label: 'Transferencia' },
                                            // "Sin pago" solo existe para postventa
                                            ...(order?.is_postventa ? [{ value: 'sin_pago', label: 'Sin pago' }] : []),
                                        ].map(m => (
                                            <button
                                                type="button"
                                                key={m.value}
                                                onClick={() => setPaymentMethod(m.value)}
                                                className={`text-xs px-2 py-2 rounded border transition-colors ${
                                                    paymentMethod === m.value
                                                        ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-300 font-medium'
                                                        : 'border-input hover:border-cyan-500/40 text-muted-foreground'
                                                }`}
                                                data-testid={`payment-method-${m.value}`}
                                            >
                                                {m.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="p-3 rounded-lg border border-border bg-muted/30 space-y-2" data-testid="invoice-block">
                                    <Label className="text-sm font-medium">Factura electrónica *</Label>
                                    <label className={`flex items-center gap-2 cursor-pointer p-2 rounded transition-colors ${requiresInvoice ? 'bg-yellow-500/10 border border-yellow-500/40' : 'hover:bg-muted/50'}`}>
                                        <input
                                            type="checkbox"
                                            checked={requiresInvoice}
                                            onChange={(e) => setRequiresInvoice(e.target.checked)}
                                            className="w-4 h-4 accent-yellow-500"
                                            data-testid="requires-invoice-checkbox"
                                        />
                                        <span className="text-xs">
                                            {requiresInvoice ? 'Sí — se añadirá 19% de IVA' : 'No requiere factura'}
                                        </span>
                                    </label>
                                </div>
                            </div>

                            {/* Total con desglose */}
                            {(() => {
                                const bk = calculateBreakdown();
                                return (
                                    <div className="p-4 rounded-lg bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/30 space-y-1" data-testid="total-breakdown">
                                        <div className="flex justify-between text-sm text-muted-foreground">
                                            <span>Subtotal servicios</span>
                                            <span className="font-mono">{formatCurrency(bk.subtotal)}</span>
                                        </div>
                                        {bk.extras.map(e => (
                                            <div key={e.id} className="flex justify-between items-center gap-2 text-sm text-green-300" data-testid={`total-extra-${e.id}`}>
                                                <span className="flex-1">+ {e.nombre}</span>
                                                <span className="font-mono">+{formatCurrency(e.price)}</span>
                                            </div>
                                        ))}
                                        {bk.cardSurcharge > 0 && (
                                            <div className="flex justify-between text-sm text-cyan-300">
                                                <span>Recargo tarjeta (5%)</span>
                                                <span className="font-mono">+{formatCurrency(bk.cardSurcharge)}</span>
                                            </div>
                                        )}
                                        {bk.iva > 0 && (
                                            <div className="flex justify-between text-sm text-yellow-300">
                                                <span>IVA (19%)</span>
                                                <span className="font-mono">+{formatCurrency(bk.iva)}</span>
                                            </div>
                                        )}
                                        {bk.discountAmount > 0 && discountApplied && (
                                            <div className="flex justify-between text-sm text-emerald-300" data-testid="total-discount">
                                                <span>
                                                    Descuento ({discountApplied.code}
                                                    {discountApplied.discount_type === 'percentage' ? ` · ${discountApplied.discount_value}%` : ''}
                                                    {discountApplied.from_appointment ? ' · desde cita' : ''})
                                                </span>
                                                <span className="font-mono">-{formatCurrency(bk.discountAmount)}</span>
                                            </div>
                                        )}
                                        <div className="flex justify-between items-center pt-2 border-t border-cyan-500/20">
                                            <span className="font-medium">Total:</span>
                                            <span className="text-2xl font-bold text-primary" data-testid="total-value">{formatCurrency(bk.total)}</span>
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Código de descuento */}
                            <div className="mt-3 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 space-y-2" data-testid="checkin-discount-block">
                                <Label className="text-sm font-medium text-emerald-300 flex items-center gap-2">
                                    <DollarSign className="w-4 h-4" /> Código de descuento (opcional)
                                </Label>
                                {order?.discount_code && discountApplied?.from_appointment ? (
                                    <div className="text-xs text-emerald-200" data-testid="checkin-discount-from-appointment">
                                        Esta orden ya tiene aplicado el código <b>{order.discount_code}</b> desde el agendamiento. No se puede aplicar otro.
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex gap-2">
                                            <Input
                                                value={discountCodeInput}
                                                onChange={(e) => {
                                                    const v = e.target.value.toUpperCase();
                                                    setDiscountCodeInput(v);
                                                    if (discountApplied && v !== discountApplied.code) setDiscountApplied(null);
                                                }}
                                                placeholder="Ej: PROMO10"
                                                disabled={!!discountApplied}
                                                data-testid="checkin-discount-input"
                                            />
                                            {discountApplied ? (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={handleRemoveDiscount}
                                                    data-testid="checkin-discount-remove-btn"
                                                >
                                                    Quitar
                                                </Button>
                                            ) : (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={handleValidateDiscount}
                                                    disabled={validatingDiscount || !discountCodeInput}
                                                    data-testid="checkin-discount-apply-btn"
                                                >
                                                    {validatingDiscount ? 'Validando...' : 'Aplicar'}
                                                </Button>
                                            )}
                                        </div>
                                        {discountApplied && !discountApplied.from_appointment && (
                                            <p className="text-xs text-emerald-300" data-testid="checkin-discount-applied-msg">
                                                Descuento aplicado: {discountApplied.code} · -{formatCurrency(calculateBreakdown().discountAmount)}
                                            </p>
                                        )}
                                    </>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Risk Agreement */}
                    <Card className="card-hover">
                        <CardHeader>
                            <CardTitle className="font-heading text-lg flex items-center gap-2">
                                <Shield className="w-5 h-5 text-yellow-500" />
                                Acuerdo de Riesgo
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {riskAgreementAccepted ? (
                                <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30 flex items-center gap-3">
                                    <CheckCircle className="w-8 h-8 text-green-500" />
                                    <div>
                                        <p className="font-medium text-green-500">Acuerdo Aceptado</p>
                                        <p className="text-sm text-muted-foreground">
                                            Todos los términos han sido aceptados
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <Button 
                                    onClick={() => setShowRiskAgreement(true)}
                                    className="w-full"
                                    variant="outline"
                                    data-testid="show-risk-agreement-btn"
                                >
                                    <Shield className="w-4 h-4 mr-2" />
                                    Ver y Aceptar Acuerdo de Riesgo
                                </Button>
                            )}
                        </CardContent>
                    </Card>

                    {/* Foto Frontal del Vehículo */}
                    <Card className="card-hover lg:col-span-2 border-yellow-500/40">
                        <CardHeader>
                            <CardTitle className="font-heading text-lg flex items-center gap-2">
                                <Car className="w-5 h-5 text-yellow-400" />
                                Foto Frontal del Vehículo *
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-col sm:flex-row items-start gap-4">
                                <div className="flex-shrink-0">
                                    {profilePhoto ? (
                                        <div className="relative w-40 h-32 rounded-lg overflow-hidden border-2 border-yellow-500/50">
                                            <img src={profilePhoto} alt="Frontal vehículo" className="w-full h-full object-cover" />
                                            <button
                                                type="button"
                                                onClick={() => setProfilePhoto(null)}
                                                className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs"
                                                data-testid="remove-profile-photo-btn"
                                            >×</button>
                                        </div>
                                    ) : (
                                        <div className="w-40 h-32 rounded-lg border-2 border-dashed border-yellow-500/40 flex items-center justify-center bg-yellow-500/5">
                                            <Car className="w-10 h-10 text-yellow-500/50" />
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 space-y-2">
                                    <p className="text-sm text-muted-foreground">
                                        Captura una foto frontal nítida del vehículo. Se usará como
                                        foto de perfil en toda la solicitud (citas, técnico, kanban, postventa).
                                    </p>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        capture="environment"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            const reader = new FileReader();
                                            reader.onload = (ev) => setProfilePhoto(ev.target.result);
                                            reader.readAsDataURL(file);
                                        }}
                                        className="w-full text-sm"
                                        data-testid="profile-photo-input"
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Cedula and Signature */}
                    <Card className="card-hover">
                        <CardHeader>
                            <CardTitle className="font-heading text-lg flex items-center gap-2">
                                <Pen className="w-5 h-5 text-primary" />
                                Cédula del Cliente
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="cedulaNumber">Número de Cédula *</Label>
                                <Input
                                    id="cedulaNumber"
                                    value={cedulaNumber}
                                    onChange={(e) => setCedulaNumber(e.target.value)}
                                    placeholder="Número de cédula"
                                    data-testid="cedula-input"
                                />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                El cliente firma al confirmar la orden, después de tocar "Aprobar Ingreso".
                            </p>

                            {/* Advertencia de Garantía de Opacidad */}
                            <div
                                className="p-4 rounded-lg border border-red-500/50 bg-red-500/10 space-y-2"
                                data-testid="warranty-warning"
                            >
                                <div className="flex items-center gap-2 text-red-500 font-semibold text-sm">
                                    <AlertTriangle className="w-4 h-4" />
                                    Avisos importantes
                                </div>
                                <ol className="list-decimal list-inside text-xs text-red-400 space-y-1 leading-relaxed">
                                    {CHECKIN_NOTICES.map(n => <li key={n}><b>{n}</b></li>)}
                                </ol>
                                <p className="text-[10px] text-muted-foreground pt-1 border-t border-red-500/20">
                                    Esta advertencia queda registrada con tu firma y se adjuntará en el recibo de ingreso.
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Submit */}
                    <div className="lg:col-span-2">
                        <Button 
                            onClick={handleSubmit}
                            className="w-full brand-glow py-6 text-lg"
                            disabled={loading || !riskAgreementAccepted}
                            data-testid="approve-ingreso-btn"
                        >
                            {loading ? (
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2" />
                            ) : (
                                <CheckCircle className="w-5 h-5 mr-2" />
                            )}
                            Aprobar Ingreso - {formatCurrency(calculateTotal())}
                        </Button>
                        {!riskAgreementAccepted && (
                            <p className="text-center text-sm text-yellow-500 mt-2">
                                * Debe aceptar el acuerdo de riesgo para continuar
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* Step "inspection": Revisión 360° dentro del wizard */}
            {step === 'inspection' && order && (
                <Card className="max-w-3xl mx-auto">
                    <CardHeader>
                        <CardTitle className="font-heading text-xl flex items-center gap-2">
                            <FileCheck className="w-5 h-5 text-purple-400" />
                            Revisión 360° — {order.plate}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Inspection360Inline
                            order={order}
                            onComplete={(saved) => {
                                setInspectionPhotosCount(saved?.photos_count || 0);
                                setStep(3);
                            }}
                            onSkip={() => {
                                setInspectionPhotosCount(0);
                                setStep(3);
                            }}
                        />
                    </CardContent>
                </Card>
            )}

            {/* Step 3: Success */}
            {step === 3 && (
                <Card className="max-w-lg mx-auto">
                    <CardContent className="pt-8 pb-8">
                        <div className="flex flex-col items-center text-center space-y-4">
                            <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center">
                                <CheckCircle className="w-10 h-10 text-green-500" />
                            </div>
                            <h2 className="font-heading text-2xl">¡Ingreso y Revisión 360° Completados!</h2>
                            <p className="text-muted-foreground">
                                El vehículo está listo para Corte / Asignación. La orden quedó en estado
                                <strong> Técnico por Asignar</strong>.
                            </p>

                            {/* Enviar fotos por email al cliente */}
                            {inspectionPhotosCount > 0 && (
                                <Button
                                    variant="outline"
                                    className="mt-2 border-purple-500/50 text-purple-400 hover:bg-purple-500/10"
                                    onClick={handleSendPhotosEmail}
                                    disabled={sendingPhotos}
                                    data-testid="send-inspection-photos-btn"
                                >
                                    {sendingPhotos ? (
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-400 mr-2" />
                                    ) : (
                                        <FileText className="w-4 h-4 mr-2" />
                                    )}
                                    Enviar {inspectionPhotosCount} foto(s) al cliente por email
                                </Button>
                            )}
                            
                            {/* Download PDF Button */}
                            <Button 
                                variant="outline"
                                className="mt-4 border-cyan-500/50 text-cyan-500 hover:bg-cyan-500/10"
                                onClick={() => {
                                    if (order) {
                                        generateOrderPDF({
                                            ...order,
                                            services: [
                                                ...selectedServices.map(s => ({
                                                    service: s.serviceId,
                                                    description: s.serviceName,
                                                    price: s.price,
                                                    parts: s.parts
                                                })),
                                                ...(sunroofLine() ? [sunroofLine()] : []),
                                            ],
                                            negotiated_value: calculateTotal(),
                                            signature_url: signature,
                                            client_id_number: cedulaNumber || order.client_id_number,
                                        });
                                        toast.success('PDF generado correctamente');
                                    } else {
                                        toast.error('No hay orden para descargar');
                                    }
                                }}
                                data-testid="download-order-pdf-btn"
                            >
                                <Download className="w-4 h-4 mr-2" />
                                Descargar Orden de Pedido (PDF)
                            </Button>
                            
                            <div className="flex gap-3 pt-4">
                                <Button variant="outline" onClick={resetForm}>
                                    Nuevo Check-in
                                </Button>
                                <Button 
                                    onClick={() => window.location.href = '/service-orders'}
                                    className="brand-glow"
                                >
                                    Ver Tablero de Órdenes
                                    <ArrowRight className="w-4 h-4 ml-2" />
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
};

export default CheckIn;
