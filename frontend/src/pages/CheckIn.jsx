import React, { useState, useCallback, useEffect } from 'react';
import { ordersAPI, servicesAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Checkbox } from '../components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { ScrollArea } from '../components/ui/scroll-area';
import { QRScanner } from '../components/QRScanner';
import { QRDisplay } from '../components/QRDisplay';
import { SignaturePad } from '../components/SignaturePad';
import { OrderStatusBadge } from '../components/OrderStatusBadge';
import { ServiceBadge } from '../components/ServiceBadge';
import { formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import { 
    QrCode, Search, Car, User, Phone, FileCheck, 
    Pen, CheckCircle, Plus, DollarSign, ArrowRight,
    Clock, AlertTriangle, Timer, FileWarning, Shield
} from 'lucide-react';
import api from '../lib/api';

// URL del acuerdo de riesgo
const RISK_AGREEMENT_IMAGE = "https://customer-assets.emergentagent.com/job_b82a71c1-21ff-43aa-b9e3-58e664ba5004/artifacts/hacjuyn5_WhatsApp%20Image%202026-03-12%20at%206.05.00%20PM.jpeg";

export const CheckIn = () => {
    const [step, setStep] = useState(1);
    const [orderCode, setOrderCode] = useState('');
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(false);
    const [serviceCatalog, setServiceCatalog] = useState([]);
    const [colombiaTime, setColombiaTime] = useState(null);
    const [waitingInfo, setWaitingInfo] = useState(null);
    
    // Form data for ingreso
    const [services, setServices] = useState([]);
    const [finalValue, setFinalValue] = useState('');
    const [signature, setSignature] = useState(null);
    const [cedulaNumber, setCedulaNumber] = useState('');
    
    // Risk Agreement Modal
    const [showRiskAgreement, setShowRiskAgreement] = useState(false);
    const [riskAgreementAccepted, setRiskAgreementAccepted] = useState(false);
    const [riskAgreementChecked, setRiskAgreementChecked] = useState(false);

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
                servicesAPI.getCatalogFlat()
            ]);
            
            setOrder(orderRes.data);
            setServiceCatalog(catalogRes.data);
            
            // Initialize services from order
            const orderServices = orderRes.data.services.map(s => s.service);
            setServices(orderServices);
            setFinalValue(orderRes.data.negotiated_value?.toString() || '');
            setCedulaNumber(orderRes.data.client_cedula || '');
            
            setStep(2);
            toast.success('Orden encontrada');
        } catch (error) {
            const errorData = error.response?.data?.detail;
            
            if (errorData && typeof errorData === 'object' && errorData.type === 'time_validation') {
                setWaitingInfo({
                    message: errorData.message,
                    timeRemaining: errorData.time_remaining,
                    slotTime: errorData.slot_time,
                    appointmentDate: errorData.appointment_date
                });
                toast.error(errorData.message);
            } else {
                const message = typeof errorData === 'string' ? errorData : 'Orden no encontrada';
                toast.error(message);
            }
        } finally {
            setLoading(false);
        }
    };

    // Toggle service selection
    const handleServiceToggle = useCallback((serviceKey) => {
        setServices(prev => {
            const isSelected = prev.includes(serviceKey);
            return isSelected 
                ? prev.filter(s => s !== serviceKey)
                : [...prev, serviceKey];
        });
    }, []);

    // Calculate total from selected services
    const calculateTotal = () => {
        return services.reduce((sum, serviceKey) => {
            const catalogItem = serviceCatalog.find(c => c.service === serviceKey);
            return sum + (catalogItem?.suggested_price || 0);
        }, 0);
    };

    // Handle risk agreement acceptance
    const handleAcceptRiskAgreement = () => {
        if (!riskAgreementChecked) {
            toast.error('Debe marcar la casilla de aceptación');
            return;
        }
        setRiskAgreementAccepted(true);
        setShowRiskAgreement(false);
        toast.success('Acuerdo de riesgo aceptado');
    };

    // Submit ingreso approval
    const handleSubmit = async () => {
        // Validations
        if (services.length === 0) {
            toast.error('Selecciona al menos un servicio');
            return;
        }
        if (!finalValue || parseFloat(finalValue) <= 0) {
            toast.error('Ingresa el valor final');
            return;
        }
        if (!signature) {
            toast.error('La firma del cliente es requerida');
            return;
        }
        if (!cedulaNumber) {
            toast.error('El número de cédula es requerido');
            return;
        }
        if (!riskAgreementAccepted) {
            toast.error('Debe aceptar el acuerdo de riesgo de servicio');
            setShowRiskAgreement(true);
            return;
        }

        setLoading(true);
        try {
            const servicesData = services.map(serviceKey => {
                const catalogItem = serviceCatalog.find(c => c.service === serviceKey);
                return {
                    service: serviceKey,
                    price: catalogItem?.suggested_price || 0,
                    description: catalogItem?.description || ''
                };
            });

            await ordersAPI.approveIngreso({
                order_id: order.id,
                services: servicesData,
                final_value: parseFloat(finalValue),
                signature_url: signature,
                cedula_number: cedulaNumber,
                risk_agreement_accepted: riskAgreementAccepted,
            });

            toast.success('Ingreso aprobado exitosamente');
            setStep(3);
        } catch (error) {
            toast.error(error.response?.data?.detail || 'Error al procesar el ingreso');
        } finally {
            setLoading(false);
        }
    };

    // Reset and start over
    const resetForm = () => {
        setStep(1);
        setOrderCode('');
        setOrder(null);
        setServices([]);
        setFinalValue('');
        setSignature(null);
        setCedulaNumber('');
        setWaitingInfo(null);
        setRiskAgreementAccepted(false);
        setRiskAgreementChecked(false);
    };

    return (
        <div className="space-y-6" data-testid="checkin-page">
            {/* Risk Agreement Modal */}
            <Dialog open={showRiskAgreement} onOpenChange={setShowRiskAgreement}>
                <DialogContent className="max-w-3xl max-h-[90vh]">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-xl flex items-center gap-2">
                            <Shield className="w-6 h-6 text-yellow-500" />
                            Acuerdo de Riesgo de Servicio
                        </DialogTitle>
                        <DialogDescription>
                            El cliente debe leer y aceptar el siguiente acuerdo antes de continuar
                        </DialogDescription>
                    </DialogHeader>
                    <ScrollArea className="h-[60vh] w-full rounded-md border p-4">
                        <img 
                            src={RISK_AGREEMENT_IMAGE} 
                            alt="Acuerdo de Riesgo de Servicio"
                            className="w-full"
                            data-testid="risk-agreement-image"
                        />
                    </ScrollArea>
                    <div className="space-y-4 pt-4">
                        <div className="flex items-start space-x-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                            <Checkbox
                                id="accept-risk"
                                checked={riskAgreementChecked}
                                onCheckedChange={(checked) => setRiskAgreementChecked(checked)}
                                data-testid="risk-agreement-checkbox"
                            />
                            <label 
                                htmlFor="accept-risk" 
                                className="text-sm cursor-pointer leading-relaxed"
                            >
                                <span className="font-medium">Acepto los términos y condiciones.</span>{' '}
                                He leído y entiendo el acuerdo de riesgo de servicio de PolarizadosYA, 
                                incluyendo las autorizaciones de instalación, responsabilidades y 
                                tratamiento de datos personales según la Ley 1581 de 2012.
                            </label>
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
                                disabled={!riskAgreementChecked}
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
                    {/* Waiting Card - When client arrives early */}
                    {waitingInfo && (
                        <Card className="lg:col-span-2 border-yellow-500/50 bg-yellow-500/10">
                            <CardContent className="pt-6">
                                <div className="flex flex-col items-center text-center space-y-4">
                                    <div className="w-16 h-16 rounded-full bg-yellow-500/20 flex items-center justify-center">
                                        <Timer className="w-8 h-8 text-yellow-500 animate-pulse" />
                                    </div>
                                    <div>
                                        <h3 className="font-heading text-xl text-yellow-500 flex items-center justify-center gap-2">
                                            <AlertTriangle className="w-5 h-5" />
                                            Debe Esperar
                                        </h3>
                                        <p className="text-lg mt-2">{waitingInfo.message}</p>
                                        {waitingInfo.timeRemaining && (
                                            <div className="mt-4 p-4 rounded-lg bg-card border">
                                                <p className="text-sm text-muted-foreground">Tiempo restante:</p>
                                                <p className="text-3xl font-mono font-bold text-primary mt-1">
                                                    {waitingInfo.timeRemaining}
                                                </p>
                                            </div>
                                        )}
                                        <p className="text-sm text-muted-foreground mt-4">
                                            Fecha de cita: {waitingInfo.appointmentDate}
                                        </p>
                                    </div>
                                    <Button 
                                        variant="outline" 
                                        onClick={() => setWaitingInfo(null)}
                                        className="mt-4"
                                    >
                                        Buscar otra orden
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Colombia Time Display */}
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
                    <Tabs defaultValue="scan" className="w-full">
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
                            <Card>
                                <CardHeader>
                                    <CardTitle className="font-heading text-lg">Escanear Código QR</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <QRScanner onScan={handleQRScan} />
                                </CardContent>
                            </Card>
                        </TabsContent>
                        <TabsContent value="code" className="mt-4">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="font-heading text-lg">Ingresar Código de Cita</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>Código de la Cita</Label>
                                        <Input
                                            value={orderCode}
                                            onChange={(e) => setOrderCode(e.target.value.toUpperCase())}
                                            placeholder="Ej: ABC12345"
                                            className="font-mono text-lg"
                                            data-testid="order-code-input"
                                        />
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
                                    <p className="text-sm">Escanea el código QR de la cita o ingresa el código manualmente</p>
                                </div>
                                <div className="flex items-start gap-3">
                                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium shrink-0">2</div>
                                    <p className="text-sm">Verifica los servicios y el valor negociado</p>
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
                            <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-sm">
                                <p className="flex items-center gap-2 text-yellow-500 font-medium">
                                    <AlertTriangle className="w-4 h-4" />
                                    Importante
                                </p>
                                <p className="text-muted-foreground mt-1">
                                    El check-in solo está disponible cuando es la hora de la franja asignada
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                        </>
                    )}
                </div>
            )}

            {/* Step 2: Verify and Approve */}
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
                                <OrderStatusBadge status={order.status} />
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
                                    <span className="text-muted-foreground">
                                        - {order.brand} {order.model}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <QrCode className="w-4 h-4 text-muted-foreground" />
                                    <span className="font-mono text-primary">{order.order_code}</span>
                                </div>
                            </div>

                            {/* QR Display */}
                            {order.qr_code && (
                                <QRDisplay 
                                    qrCode={order.qr_code}
                                    orderCode={order.order_code}
                                    clientName={order.client_name}
                                />
                            )}
                        </CardContent>
                    </Card>

                    {/* Services and Value */}
                    <Card className="card-hover">
                        <CardHeader>
                            <CardTitle className="font-heading text-lg flex items-center gap-2">
                                <DollarSign className="w-5 h-5 text-primary" />
                                Servicios y Valor
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Original Services */}
                            <div className="space-y-2">
                                <Label>Servicios de la Cita</Label>
                                <div className="flex flex-wrap gap-2">
                                    {order.services?.map((s, idx) => (
                                        <ServiceBadge key={idx} service={s.service} />
                                    ))}
                                </div>
                            </div>

                            {/* Negotiated Value */}
                            <div className="space-y-2">
                                <Label>Valor Negociado</Label>
                                <p className="text-2xl font-bold text-primary">
                                    {formatCurrency(order.negotiated_value || 0)}
                                </p>
                            </div>

                            {/* Final Value */}
                            <div className="space-y-2">
                                <Label htmlFor="finalValue">Valor Final *</Label>
                                <Input
                                    id="finalValue"
                                    type="number"
                                    min="0"
                                    value={finalValue}
                                    onChange={(e) => setFinalValue(e.target.value)}
                                    placeholder="Valor final a pagar"
                                    data-testid="final-value-input"
                                />
                                {finalValue && (
                                    <p className="text-sm text-muted-foreground">
                                        {formatCurrency(parseFloat(finalValue) || 0)}
                                    </p>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Risk Agreement Section */}
                    <Card className="card-hover">
                        <CardHeader>
                            <CardTitle className="font-heading text-lg flex items-center gap-2">
                                <Shield className="w-5 h-5 text-yellow-500" />
                                Acuerdo de Riesgo
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {riskAgreementAccepted ? (
                                <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30 flex items-center gap-3">
                                    <CheckCircle className="w-8 h-8 text-green-500" />
                                    <div>
                                        <p className="font-medium text-green-500">Acuerdo Aceptado</p>
                                        <p className="text-sm text-muted-foreground">
                                            El cliente ha aceptado los términos y condiciones del servicio
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                                        <p className="text-sm text-muted-foreground">
                                            Antes de continuar, el cliente debe leer y aceptar el acuerdo de riesgo 
                                            de servicio que incluye autorizaciones de instalación y responsabilidades.
                                        </p>
                                    </div>
                                    <Button 
                                        onClick={() => setShowRiskAgreement(true)}
                                        className="w-full"
                                        variant="outline"
                                        data-testid="show-risk-agreement-btn"
                                    >
                                        <FileWarning className="w-4 h-4 mr-2" />
                                        Ver y Aceptar Acuerdo de Riesgo
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Cedula and Signature */}
                    <Card className="card-hover">
                        <CardHeader>
                            <CardTitle className="font-heading text-lg flex items-center gap-2">
                                <Pen className="w-5 h-5 text-primary" />
                                Cédula y Firma
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Cedula Number */}
                            <div className="space-y-2">
                                <Label htmlFor="cedulaNumber">Número de Cédula *</Label>
                                <Input
                                    id="cedulaNumber"
                                    value={cedulaNumber}
                                    onChange={(e) => setCedulaNumber(e.target.value)}
                                    placeholder="Ingresa el número de cédula"
                                    data-testid="cedula-input"
                                />
                            </div>

                            {/* Signature */}
                            <div className="space-y-2">
                                <Label>Firma del Cliente *</Label>
                                <SignaturePad
                                    onSave={(data) => setSignature(data)}
                                    savedSignature={signature}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Submit Button */}
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
                            Aprobar Ingreso
                        </Button>
                        {!riskAgreementAccepted && (
                            <p className="text-center text-sm text-yellow-500 mt-2">
                                * Debe aceptar el acuerdo de riesgo para continuar
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* Step 3: Success */}
            {step === 3 && (
                <Card className="max-w-lg mx-auto">
                    <CardContent className="pt-8 pb-8">
                        <div className="flex flex-col items-center text-center space-y-4">
                            <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center">
                                <CheckCircle className="w-10 h-10 text-green-500" />
                            </div>
                            <h2 className="font-heading text-2xl">¡Ingreso Aprobado!</h2>
                            <p className="text-muted-foreground">
                                El vehículo ha sido registrado exitosamente. 
                                Ahora puede proceder a la revisión 360°.
                            </p>
                            <div className="flex gap-3 pt-4">
                                <Button variant="outline" onClick={resetForm}>
                                    Nuevo Check-in
                                </Button>
                                <Button 
                                    onClick={() => window.location.href = '/inspections'}
                                    className="brand-glow"
                                >
                                    Ir a Revisión 360°
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
