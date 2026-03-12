import React, { useState, useCallback, useEffect } from 'react';
import { ordersAPI, servicesAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Checkbox } from '../components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { QRScanner } from '../components/QRScanner';
import { QRDisplay } from '../components/QRDisplay';
import { SignaturePad } from '../components/SignaturePad';
import { SinglePhotoCapture } from '../components/SinglePhotoCapture';
import { OrderStatusBadge } from '../components/OrderStatusBadge';
import { ServiceBadge } from '../components/ServiceBadge';
import { formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import { 
    QrCode, Search, Car, User, Phone, FileCheck, 
    Pen, Camera, CheckCircle, Plus, DollarSign, ArrowRight,
    Clock, AlertTriangle, Timer
} from 'lucide-react';
import api from '../lib/api';

export const CheckIn = () => {
    const [step, setStep] = useState(1);
    const [orderCode, setOrderCode] = useState('');
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(false);
    const [serviceCatalog, setServiceCatalog] = useState([]);
    const [colombiaTime, setColombiaTime] = useState(null);
    const [waitingInfo, setWaitingInfo] = useState(null); // Info when must wait
    
    // Form data for ingreso
    const [services, setServices] = useState([]);
    const [finalValue, setFinalValue] = useState('');
    const [signature, setSignature] = useState(null);
    const [cedulaNumber, setCedulaNumber] = useState('');
    const [cedulaPhoto, setCedulaPhoto] = useState(null);
    const [clientPhoto, setClientPhoto] = useState(null);
    const [showCedulaCamera, setShowCedulaCamera] = useState(false);
    const [showClientCamera, setShowClientCamera] = useState(false);

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
        const interval = setInterval(fetchTime, 30000); // Update every 30 seconds
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
                servicesAPI.getCatalog()
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
            
            // Check if it's a time validation error
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
                cedula_photo_url: cedulaPhoto || null,
                client_photo_url: clientPhoto || null,
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
        setCedulaPhoto(null);
        setClientPhoto(null);
        setWaitingInfo(null);
    };

    return (
        <div className="space-y-6" data-testid="checkin-page">
            {/* Header */}
            <div>
                <h1 className="font-heading text-3xl md:text-4xl">Check-in / Ingreso</h1>
                <p className="text-muted-foreground">
                    Escanea el QR o ingresa el código para procesar el ingreso del vehículo
                </p>
            </div>

            {/* Step Progress */}
            <div className="flex items-center justify-center gap-2">
                {[1, 2, 3].map((s) => (
                    <div key={s} className="flex items-center">
                        <div className={`
                            w-10 h-10 rounded-full flex items-center justify-center font-bold
                            ${step >= s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}
                        `}>
                            {step > s ? <CheckCircle className="w-5 h-5" /> : s}
                        </div>
                        {s < 3 && (
                            <div className={`w-16 h-1 mx-1 ${step > s ? 'bg-primary' : 'bg-muted'}`} />
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
                            <TabsTrigger value="scan">
                                <QrCode className="w-4 h-4 mr-2" />
                                Escanear QR
                            </TabsTrigger>
                            <TabsTrigger value="code">
                                <Search className="w-4 h-4 mr-2" />
                                Ingresar Código
                            </TabsTrigger>
                        </TabsList>
                        <TabsContent value="scan" className="mt-4">
                            <QRScanner onScan={handleQRScan} />
                        </TabsContent>
                        <TabsContent value="code" className="mt-4">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="font-heading text-lg flex items-center gap-2">
                                        <Search className="w-5 h-5 text-primary" />
                                        Buscar por Código
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="orderCode">Código de Cita</Label>
                                        <Input
                                            id="orderCode"
                                            value={orderCode}
                                            onChange={(e) => setOrderCode(e.target.value.toUpperCase())}
                                            placeholder="Ej: ABC12345"
                                            className="font-mono text-lg"
                                            data-testid="order-code-input"
                                        />
                                    </div>
                                    <Button 
                                        onClick={() => searchOrder(orderCode)}
                                        className="w-full brand-glow"
                                        disabled={loading}
                                        data-testid="search-order-btn"
                                    >
                                        {loading ? 'Buscando...' : 'Buscar Orden'}
                                    </Button>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>

                    <Card className="bg-muted/30">
                        <CardHeader>
                            <CardTitle className="font-heading text-lg">Instrucciones</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                                    <span className="font-bold text-primary">1</span>
                                </div>
                                <div>
                                    <p className="font-medium">Escanear o ingresar código</p>
                                    <p className="text-sm text-muted-foreground">
                                        Usa la cámara para escanear el QR del cliente o ingresa el código manualmente
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                                    <span className="font-bold text-primary">2</span>
                                </div>
                                <div>
                                    <p className="font-medium">Verificar y modificar servicios</p>
                                    <p className="text-sm text-muted-foreground">
                                        Puedes agregar servicios adicionales y ajustar el valor
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                                    <span className="font-bold text-primary">3</span>
                                </div>
                                <div>
                                    <p className="font-medium">Aprobar con firma</p>
                                    <p className="text-sm text-muted-foreground">
                                        El cliente firma digitalmente y se toma foto de cédula
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                        </>
                    )}
                </div>
            )}

            {/* Step 2: Verify and Approve */}
            {step === 2 && order && (
                <div className="grid lg:grid-cols-3 gap-6">
                    {/* Order Info */}
                    <Card className="lg:col-span-2">
                        <CardHeader>
                            <CardTitle className="font-heading text-lg flex items-center justify-between">
                                <span className="flex items-center gap-2">
                                    <Car className="w-5 h-5 text-primary" />
                                    Datos de la Orden
                                </span>
                                <OrderStatusBadge status={order.status} />
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {/* Client & Vehicle Info */}
                            <div className="grid sm:grid-cols-2 gap-4 p-4 rounded-lg bg-muted/50">
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <User className="w-4 h-4 text-muted-foreground" />
                                        <span className="font-medium">{order.client_name}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Phone className="w-4 h-4 text-muted-foreground" />
                                        <span>{order.client_phone}</span>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <Car className="w-4 h-4 text-muted-foreground" />
                                        <span className="font-mono font-bold">{order.plate}</span>
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                        {order.brand} {order.model} {order.year} {order.color}
                                    </p>
                                </div>
                            </div>

                            {/* Services Selection */}
                            <div className="space-y-3">
                                <Label className="flex items-center gap-2">
                                    <Plus className="w-4 h-4" />
                                    Servicios (puedes agregar más)
                                </Label>
                                <div className="grid sm:grid-cols-2 gap-2">
                                    {serviceCatalog.map((item) => (
                                        <div
                                            key={item.service}
                                            className={`
                                                flex items-center space-x-3 p-3 rounded-lg border transition-colors
                                                ${services.includes(item.service) 
                                                    ? 'border-primary bg-primary/10' 
                                                    : 'border-border bg-muted/30 hover:bg-muted/50'}
                                            `}
                                        >
                                            <Checkbox
                                                id={`svc-${item.service}`}
                                                checked={services.includes(item.service)}
                                                onCheckedChange={() => handleServiceToggle(item.service)}
                                                data-testid={`checkin-service-${item.service}`}
                                            />
                                            <label 
                                                htmlFor={`svc-${item.service}`} 
                                                className="flex-1 cursor-pointer"
                                            >
                                                <span className="font-medium">{item.name}</span>
                                                <span className="block text-sm text-muted-foreground">
                                                    {formatCurrency(item.suggested_price)}
                                                </span>
                                            </label>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex items-center justify-between p-3 rounded-lg bg-primary/10 border border-primary/30">
                                    <span className="font-medium">Total Sugerido:</span>
                                    <span className="font-mono font-bold text-lg text-primary">
                                        {formatCurrency(calculateTotal())}
                                    </span>
                                </div>
                            </div>

                            {/* Final Value */}
                            <div className="space-y-2">
                                <Label className="flex items-center gap-2">
                                    <DollarSign className="w-4 h-4" />
                                    Valor Final Negociado *
                                </Label>
                                <Input
                                    type="number"
                                    value={finalValue}
                                    onChange={(e) => setFinalValue(e.target.value)}
                                    placeholder="0"
                                    className="font-mono text-lg"
                                    data-testid="final-value-input"
                                />
                            </div>

                            {/* Cedula */}
                            <div className="space-y-2">
                                <Label>Número de Cédula *</Label>
                                <Input
                                    value={cedulaNumber}
                                    onChange={(e) => setCedulaNumber(e.target.value)}
                                    placeholder="1234567890"
                                    data-testid="cedula-input"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* QR Display */}
                    <div className="space-y-6">
                        <QRDisplay 
                            qrCode={order.qr_code}
                            orderCode={order.order_code}
                            clientName={order.client_name}
                        />
                    </div>
                </div>
            )}

            {/* Step 2 continued: Signature and Photos */}
            {step === 2 && order && (
                <div className="grid lg:grid-cols-3 gap-6">
                    {/* Signature */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="font-heading text-lg flex items-center gap-2">
                                <Pen className="w-5 h-5 text-primary" />
                                Firma del Cliente *
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <SignaturePad onSave={setSignature} />
                            {signature && (
                                <div className="mt-3 flex items-center gap-2 text-green-500 text-sm">
                                    <CheckCircle className="w-4 h-4" />
                                    Firma capturada
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Cedula Photo */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="font-heading text-lg flex items-center gap-2">
                                <FileCheck className="w-5 h-5 text-primary" />
                                Foto de Cédula
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {showCedulaCamera ? (
                                <SinglePhotoCapture 
                                    onCapture={(photo) => {
                                        setCedulaPhoto(photo);
                                        setShowCedulaCamera(false);
                                    }}
                                    onClose={() => setShowCedulaCamera(false)}
                                />
                            ) : cedulaPhoto ? (
                                <div className="space-y-3">
                                    <img 
                                        src={cedulaPhoto} 
                                        alt="Cédula" 
                                        className="w-full rounded-lg"
                                    />
                                    <Button 
                                        variant="outline" 
                                        size="sm" 
                                        onClick={() => setShowCedulaCamera(true)}
                                    >
                                        Retomar foto
                                    </Button>
                                </div>
                            ) : (
                                <Button 
                                    variant="outline" 
                                    className="w-full h-24"
                                    onClick={() => setShowCedulaCamera(true)}
                                    data-testid="cedula-photo-btn"
                                >
                                    <Camera className="w-6 h-6 mr-2" />
                                    Tomar Foto
                                </Button>
                            )}
                        </CardContent>
                    </Card>

                    {/* Client Photo */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="font-heading text-lg flex items-center gap-2">
                                <User className="w-5 h-5 text-primary" />
                                Foto del Cliente
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {showClientCamera ? (
                                <SinglePhotoCapture 
                                    onCapture={(photo) => {
                                        setClientPhoto(photo);
                                        setShowClientCamera(false);
                                    }}
                                    onClose={() => setShowClientCamera(false)}
                                />
                            ) : clientPhoto ? (
                                <div className="space-y-3">
                                    <img 
                                        src={clientPhoto} 
                                        alt="Cliente" 
                                        className="w-full rounded-lg"
                                    />
                                    <Button 
                                        variant="outline" 
                                        size="sm" 
                                        onClick={() => setShowClientCamera(true)}
                                    >
                                        Retomar foto
                                    </Button>
                                </div>
                            ) : (
                                <Button 
                                    variant="outline" 
                                    className="w-full h-24"
                                    onClick={() => setShowClientCamera(true)}
                                    data-testid="client-photo-btn"
                                >
                                    <Camera className="w-6 h-6 mr-2" />
                                    Tomar Foto
                                </Button>
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Step 2: Submit Button */}
            {step === 2 && (
                <div className="flex justify-center gap-4">
                    <Button variant="outline" onClick={resetForm}>
                        Cancelar
                    </Button>
                    <Button 
                        onClick={handleSubmit}
                        className="brand-glow min-w-[200px]"
                        disabled={loading}
                        data-testid="approve-ingreso-btn"
                    >
                        {loading ? 'Procesando...' : (
                            <>
                                <CheckCircle className="w-4 h-4 mr-2" />
                                Aprobar Ingreso
                            </>
                        )}
                    </Button>
                </div>
            )}

            {/* Step 3: Success */}
            {step === 3 && (
                <Card className="max-w-lg mx-auto">
                    <CardContent className="pt-6 text-center space-y-4">
                        <div className="w-20 h-20 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
                            <CheckCircle className="w-10 h-10 text-green-500" />
                        </div>
                        <h2 className="font-heading text-2xl">Ingreso Completado</h2>
                        <p className="text-muted-foreground">
                            El vehículo <span className="font-mono font-bold">{order?.plate}</span> ha sido ingresado exitosamente.
                        </p>
                        <p className="text-sm text-muted-foreground">
                            Ahora debe realizarse la Revisión 360° antes de asignar un técnico.
                        </p>
                        <div className="flex gap-4 justify-center pt-4">
                            <Button variant="outline" onClick={resetForm}>
                                Nuevo Ingreso
                            </Button>
                            <Button onClick={() => window.location.href = '/inspections'} className="brand-glow">
                                Ir a Revisión 360°
                                <ArrowRight className="w-4 h-4 ml-2" />
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
};

export default CheckIn;
