import React, { useEffect, useState } from 'react';
import { reportsAPI } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { toast } from 'sonner';
import {
    FileSpreadsheet, Loader2, Download, HandCoins, CarFront, Wallet, Landmark, CalendarDays, BadgeCheck, Boxes,
} from 'lucide-react';

const REPORT_INFO = {
    liquidaciones: { icon: HandCoins, single: false, text: 'Pago a instaladores (cobros de técnicos) y a asesores (comisión por check-in), con resumen por persona y lo que falta por pagar.' },
    'servicios-diario': { icon: CarFront, single: true, text: 'Autos que ingresaron, terminaron o se entregaron ese día, y todos los autos que aún no han salido del taller.' },
    pagos: { icon: Wallet, single: false, text: 'Pagos y abonos registrados: totales por día y método de pago, y el detalle de cada pago.' },
    retenciones: { icon: Landmark, single: false, text: 'Retención vigente de cada orden: base sin IVA, Retefuente, ICA, total retenido y certificado; resumen por cliente.' },
    agendamiento: { icon: CalendarDays, single: false, text: 'Citas creadas por cada asesor: cuántas llegaron a check-in, desistidas y valor agendado.' },
    calidad: { icon: BadgeCheck, single: false, text: 'Revisiones de calidad: aprobadas, rechazadas, calificación y novedades; resumen por técnico.' },
    inventario: { icon: Boxes, single: false, text: 'Lo que queda de cada artículo (metros o unidades), alertas de stock bajo y los movimientos del periodo.' },
};

const iso = (d) => {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
};
const today = () => iso(new Date());

const PRESETS = [
    ['Hoy', () => [today(), today()]],
    ['Últimos 7 días', () => { const d = new Date(); d.setDate(d.getDate() - 6); return [iso(d), today()]; }],
    ['Este mes', () => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), today()]; }],
    ['Mes anterior', () => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), iso(new Date(d.getFullYear(), d.getMonth(), 0))]; }],
];

const ReportCard = ({ report }) => {
    const info = REPORT_INFO[report.id] || { icon: FileSpreadsheet, text: '' };
    const [from, setFrom] = useState(() => PRESETS[2][1]()[0]);
    const [to, setTo] = useState(today());
    const [day, setDay] = useState(today());
    const [busy, setBusy] = useState(false);
    const Icon = info.icon;

    const download = async () => {
        const params = info.single ? { date_from: day, date_to: day } : { date_from: from, date_to: to };
        if (!info.single && from > to) { toast.error('La fecha inicial debe ser anterior a la final'); return; }
        setBusy(true);
        try {
            const res = await reportsAPI.download(report.id, params);
            const url = URL.createObjectURL(res.data);
            const a = document.createElement('a');
            a.href = url;
            a.download = `reporte_${report.id}_${params.date_from}${params.date_from === params.date_to ? '' : `_${params.date_to}`}.xlsx`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            toast.success('Reporte descargado');
        } catch (e) {
            let msg = 'No se pudo generar el reporte';
            try { msg = JSON.parse(await e.response.data.text()).detail || msg; } catch (_) { /* respuesta no JSON */ }
            toast.error(msg);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card data-testid={`report-${report.id}`}>
            <CardContent className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-emerald-500/10"><Icon className="w-5 h-5 text-emerald-400" /></div>
                    <div className="min-w-0">
                        <p className="font-medium">{report.title}</p>
                        <p className="text-xs text-muted-foreground">{info.text}</p>
                    </div>
                </div>
                {info.single ? (
                    <div className="space-y-1">
                        <Label className="text-xs">Día</Label>
                        <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-44" data-testid={`report-day-${report.id}`} />
                    </div>
                ) : (
                    <>
                        <div className="flex gap-2 flex-wrap">
                            <div className="space-y-1">
                                <Label className="text-xs">Desde</Label>
                                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" data-testid={`report-from-${report.id}`} />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Hasta</Label>
                                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" data-testid={`report-to-${report.id}`} />
                            </div>
                        </div>
                        <div className="flex gap-1 flex-wrap">
                            {PRESETS.map(([label, fn]) => (
                                <button key={label} type="button" className="text-xs px-2 py-1 rounded border border-border hover:bg-muted/50"
                                    onClick={() => { const [f, t] = fn(); setFrom(f); setTo(t); }}>{label}</button>
                            ))}
                        </div>
                    </>
                )}
                <Button className="w-full" onClick={download} disabled={busy} data-testid={`report-download-${report.id}`}>
                    {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                    Descargar Excel
                </Button>
            </CardContent>
        </Card>
    );
};

/** Módulo de reportes: cada reporte se descarga en Excel según el rango de fechas */
export const Reportes = () => {
    const [reports, setReports] = useState(null);

    useEffect(() => {
        reportsAPI.list().then(({ data }) => setReports(data)).catch(() => { setReports([]); toast.error('No se pudieron cargar los reportes'); });
    }, []);

    return (
        <div className="space-y-6" data-testid="reportes-page">
            <div>
                <h1 className="font-heading text-3xl md:text-4xl flex items-center gap-2"><FileSpreadsheet className="w-8 h-8 text-emerald-400" /> Reportes</h1>
                <p className="text-muted-foreground">Elige el periodo y descarga cada reporte en Excel.</p>
            </div>
            {!reports ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin" /></div>
            ) : reports.length === 0 ? (
                <p className="text-center py-12 text-muted-foreground text-sm">No tienes reportes disponibles.</p>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {reports.map(r => <ReportCard key={r.id} report={r} />)}
                </div>
            )}
        </div>
    );
};

export default Reportes;
