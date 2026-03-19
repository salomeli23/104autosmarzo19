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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../components/ui/accordion';
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
    Clock, AlertTriangle, Timer, Shield, Package, Trash2
} from 'lucide-react';
import api from '../lib/api';

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
    // { serviceId: string, serviceName: string, category: string, price: number }
    
    const [signature, setSignature] = useState(null);
    const [cedulaNumber, setCedulaNumber] = useState('');
    
    // Risk Agreement Modal
    const [showRiskAgreement, setShowRiskAgreement] = useState(false);
    const [riskAgreementAccepted, setRiskAgreementAccepted] = useState(false);
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
            
            // Initialize services from order with prices
            const initialServices = orderRes.data.services?.map(s => ({
                serviceId: s.service,
                serviceName: s.description?.split(' - ')[1] || s.service,
                category: s.description?.split(' - ')[0] || 'Servicio',
                price: s.price || 0
            })) || [];
            setSelectedServices(initialServices);
            setCedulaNumber(orderRes.data.client_cedula || '');
            
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
            } else {
                const message = typeof errorData === 'string' ? errorData : 'Orden no encontrada';
                toast.error(message);
            }
        } finally {
            setLoading(false);
        }
    };

    // Toggle service selection (for upsell)
    const handleServiceToggle = (serviceId, serviceName, categoryName) => {
        setSelectedServices(prev => {
            const exists = prev.find(s => s.serviceId === serviceId);
            if (exists) {
                return prev.filter(s => s.serviceId !== serviceId);
            } else {
                return [...prev, { serviceId, serviceName, category: categoryName, price: 0 }];
            }
        });
    };

    // Update service price
    const handleServicePriceChange = (serviceId, price) => {
        setSelectedServices(prev => 
            prev.map(s => s.serviceId === serviceId ? { ...s, price: parseFloat(price) || 0 } : s)
        );
    };

    // Remove service
    const handleRemoveService = (serviceId) => {
        setSelectedServices(prev => prev.filter(s => s.serviceId !== serviceId));
    };

    // Calculate total
    const calculateTotal = () => {
        return selectedServices.reduce((sum, svc) => sum + (svc.price || 0), 0);
    };

    // Check if all risk checks are complete
    const allRiskChecksComplete = Object.values(riskChecks).every(v => v);

    // Handle risk agreement acceptance
    const handleAcceptRiskAgreement = () => {
        if (!allRiskChecksComplete) {
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
        if (total <= 0) {
            toast.error('Ingresa el valor de al menos un servicio');
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
            const servicesData = selectedServices.map(svc => ({
                service: svc.serviceId,
                price: svc.price,
                description: `${svc.category} - ${svc.serviceName}`
            }));

            await ordersAPI.approveIngreso({
                order_id: order.id,
                services: servicesData,
                final_value: total,
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

    // Reset form
    const resetForm = () => {
        setStep(1);
        setOrderCode('');
        setOrder(null);
        setSelectedServices([]);
        setSignature(null);
        setCedulaNumber('');
        setWaitingInfo(null);
        setRiskAgreementAccepted(false);
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
            {/* Risk Agreement Modal - Styled Content */}
            <Dialog open={showRiskAgreement} onOpenChange={setShowRiskAgreement}>
                <DialogContent className="max-w-3xl max-h-[90vh]">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-xl flex items-center gap-2">
                            <Shield className="w-6 h-6 text-cyan-400" />
                            Acuerdo de Riesgo de Servicio
                        </DialogTitle>
                        <DialogDescription>
                            El cliente debe leer y aceptar cada punto antes de continuar
                        </DialogDescription>
                    </DialogHeader>
                    <ScrollArea className="h-[55vh] pr-4">
                        <div className="space-y-4">
                            {/* Header del documento */}
                            <div className="text-center p-4 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 rounded-lg border border-cyan-500/30">
                                <h3 className="font-heading text-lg text-cyan-400">POLARIZADOS YA!</h3>
                                <p className="text-sm text-muted-foreground">Términos y Condiciones del Servicio</p>
                            </div>

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

                            {/* Sección 4: Autorizaciones */}
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
                                            Autorizaciones
                                        </label>
                                        <p className="text-sm text-muted-foreground mt-1">
                                            Autorizo a POLARIZADOSYA para que instale los productos acordados en esta orden de pedido, 
                                            así mismo los autorizo para que una vez terminada la instalación, pueda probar el vehículo 
                                            dentro del circuito que se tenga fijado, si bien la instalación lo amerita. Autorizo a POLARIZADOSYA 
                                            a retener el vehículo durante el tiempo en que no haya sido cancelado este pedido.
                                        </p>
                                        <p className="text-sm text-muted-foreground mt-2">
                                            <span className="text-yellow-500">RESPONSABILIDAD DE POLARIZADOSYA:</span> No responde por la pérdida 
                                            de objetos o bienes de cualquier índole, si estos no han sido reportados por el cliente y relacionados 
                                            en el presente pedido.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Sección 5: Porcentajes */}
                            <div className={`p-4 rounded-lg border transition-all ${riskChecks.porcentajes ? 'border-green-500/50 bg-green-500/5' : 'border-border'}`}>
                                <div className="flex items-start gap-3">
                                    <Checkbox
                                        id="check-porcentajes"
                                        checked={riskChecks.porcentajes}
                                        onCheckedChange={(checked) => setRiskChecks(prev => ({...prev, porcentajes: checked}))}
                                        className="mt-1"
                                    />
                                    <div className="flex-1">
                                        <label htmlFor="check-porcentajes" className="font-medium cursor-pointer text-cyan-400">
                                            Instalación de Porcentajes
                                        </label>
                                        <p className="text-sm text-muted-foreground mt-1">
                                            <span className="text-white font-medium">Cliente autoriza instalación de porcentajes que están por 
                                            fuera de lo permitido, de acuerdo a la Resolución No. 3777 del año 2003. Aprobado por el cliente.</span>
                                        </p>
                                        <p className="text-sm text-muted-foreground mt-2">
                                            RESPONSABILIDAD DE POLARIZADOSYA: No responde por la pérdida de objetos o bienes de cualquier índole, 
                                            si estos no han sido reportados por el cliente y relacionados en el presente pedido.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Sección 6: Datos Personales */}
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
                                            El uso de la información suministrada a POLARIZADOS YA, está limitada únicamente a fines privados 
                                            y amparados por la ley, que hacen parte de las bases de datos de clientes 
                                            (<span className="text-yellow-500">Ley 1581 de 2012</span> protección de datos de carácter personal).
                                        </p>
                                        <p className="text-sm text-muted-foreground mt-2">
                                            La información aquí contenida está acorde con lo establecido en la 
                                            <span className="text-yellow-500"> Ley 1480 de 2011</span> protección al consumidor.
                                        </p>
                                    </div>
                                </div>
                            </div>

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
                                Puntos aceptados: {Object.values(riskChecks).filter(v => v).length} de 6
                            </span>
                            <div className="flex gap-1">
                                {Object.values(riskChecks).map((checked, i) => (
                                    <div 
                                        key={i} 
                                        className={`w-3 h-3 rounded-full transition-colors ${checked ? 'bg-green-500' : 'bg-muted'}`}
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
                                disabled={!allRiskChecksComplete}
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
                        <Card className="lg:col-span-2 border-yellow-500/50 bg-yellow-500/10">
                            <CardContent className="pt-6">
                                <div className="flex flex-col items-center text-center space-y-4">
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
                            <Tabs defaultValue="code" className="w-full">
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
                                            <p className="text-sm">Escanea el código QR o ingresa el código manualmente</p>
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
                                            <div key={svc.serviceId} className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/30">
                                                <div className="flex-1">
                                                    <p className="font-medium text-sm">{svc.serviceName}</p>
                                                    <p className="text-xs text-muted-foreground">{svc.category}</p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm">$</span>
                                                    <Input
                                                        type="number"
                                                        min="0"
                                                        value={svc.price || ''}
                                                        onChange={(e) => handleServicePriceChange(svc.serviceId, e.target.value)}
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
                                                                    isSelected ? 'bg-primary/20' : 'hover:bg-muted/50'
                                                                }`}
                                                                onClick={() => !isSelected && handleServiceToggle(service.id, service.name, category.name)}
                                                            >
                                                                <Checkbox
                                                                    checked={isSelected}
                                                                    onCheckedChange={() => handleServiceToggle(service.id, service.name, category.name)}
                                                                />
                                                                <span className="text-sm">{service.name}</span>
                                                                {isSelected && <CheckCircle className="w-4 h-4 text-green-500 ml-auto" />}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </AccordionContent>
                                        </AccordionItem>
                                    ))}
                                </Accordion>
                            </div>

                            {/* Total */}
                            <div className="p-4 rounded-lg bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/30">
                                <div className="flex justify-between items-center">
                                    <span className="font-medium">Total:</span>
                                    <span className="text-2xl font-bold text-primary">{formatCurrency(calculateTotal())}</span>
                                </div>
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

                    {/* Cedula and Signature */}
                    <Card className="card-hover">
                        <CardHeader>
                            <CardTitle className="font-heading text-lg flex items-center gap-2">
                                <Pen className="w-5 h-5 text-primary" />
                                Cédula y Firma
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
                            <div className="space-y-2">
                                <Label>Firma del Cliente *</Label>
                                <SignaturePad
                                    onSave={(data) => setSignature(data)}
                                    savedSignature={signature}
                                />
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
                                El vehículo ha sido registrado. Proceda a la revisión 360°.
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
