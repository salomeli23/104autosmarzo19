import React, { useEffect, useState } from 'react';
import { technicianChargesAPI } from '../lib/api';
import { Card, CardContent } from './ui/card';
import { formatCurrency } from '../lib/utils';
import { Loader2 } from 'lucide-react';

const INSTALLER_PIECES = ['completo', 'panoramicos', 'panoramico', 'laterales', 'lateral'];
const ADVISOR_PIECES = ['full', 'descuento', 'panoramico', 'panoramicos', 'lateral', 'laterales'];

const Box = ({ title, children }) => (
    <Card>
        <CardContent className="p-4 space-y-2">
            <p className="font-medium text-sm">{title}</p>
            {children}
        </CardContent>
    </Card>
);

const Row = ({ label, value }) => (
    <div className="flex justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{formatCurrency(value)}</span>
    </div>
);

const Grid = ({ head, rows }) => (
    <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
            <thead className="bg-muted/50">
                <tr>{head.map((h, i) => <th key={i} className={`p-2 whitespace-nowrap ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
                {rows.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                        {r.map((c, j) => <td key={j} className={`p-2 ${j ? 'text-right font-mono' : 'whitespace-nowrap'}`}>{j ? formatCurrency(c) : c}</td>)}
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

/** Tablas de pago 2026 (solo lectura). kind: 'installers' | 'advisors' */
export const InstallerRatesTable = ({ kind = 'installers' }) => {
    const [rates, setRates] = useState(null);

    useEffect(() => {
        technicianChargesAPI.rates().then(({ data }) => setRates(data)).catch(() => setRates({}));
    }, []);

    if (!rates) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin" /></div>;
    const t = rates[kind];
    if (!t) return <p className="text-center py-12 text-muted-foreground text-sm">No se pudo cargar la tabla de tarifas.</p>;

    if (kind === 'installers') {
        const pieceLabel = (p) => (p === 'completo' ? 'Completo' : t.piece_labels[p].replace(/^./, c => c.toUpperCase()));
        return (
            <div className="space-y-4" data-testid="installer-rates">
                <Grid head={['Polarizado', ...INSTALLER_PIECES.map(pieceLabel)]}
                    rows={t.polarizado.flatMap(r => ['automovil', 'camioneta'].map(vt => [
                        `${r.label} · ${t.vehicle_types[vt]}`, ...INSTALLER_PIECES.map(p => r[vt][p])]))} />
                <div className="grid gap-3 md:grid-cols-3">
                    <Box title="Ultrasecure · automóvil completo">
                        {t.ultrasecure.map(u => <Row key={u.micras} label={`${u.micras} micras`} value={u.amount} />)}
                    </Box>
                    <Box title="Tesla techos">
                        {t.tesla_roof.map(r => <Row key={r.id} label={r.label.replace(' (Tesla)', '')} value={r.amount} />)}
                    </Box>
                    <Box title="Retiradas">
                        {t.removals.map(r => <Row key={r.id} label={r.label.replace('Retirada película ', '').replace(/^./, c => c.toUpperCase())} value={r.amount} />)}
                    </Box>
                </div>
            </div>
        );
    }

    const films = Object.keys(t.ultrasecure_films);
    const ppf = t.ppf.map((r, i) => {
        const next = t.ppf[i + 1];
        const label = i === 0 ? `Por debajo de ${formatCurrency(next.since)}`
            : next ? `${formatCurrency(r.since)} a ${formatCurrency(next.since - 1)}` : `${formatCurrency(r.since)} o más`;
        return { label, amount: r.amount };
    });
    return (
        <div className="space-y-4" data-testid="advisor-rates">
            <Grid head={['Polarizado', ...ADVISOR_PIECES.map(p => t.piece_labels[p])]}
                rows={t.polarizado.map(r => [r.label, ...ADVISOR_PIECES.map(p => r[p])])} />
            <Grid head={['Ultrasecure', ...films.flatMap(f => [`${t.ultrasecure_films[f]} full`, 'desc.'])]}
                rows={t.ultrasecure.map(u => [`${u.micras} micras`, ...films.flatMap(f => [u.rates[f].full, u.rates[f].descuento])])} />
            <div className="grid gap-3 md:grid-cols-2">
                <Box title="PPF · según valor de venta">
                    {ppf.map(r => <Row key={r.label} label={r.label} value={r.amount} />)}
                </Box>
                <Box title="Techo">
                    <Row label="Sobre el valor de la venta" value={t.roof} />
                    <p className="text-[11px] text-muted-foreground">"Descuento" aplica cuando la orden tiene código de descuento o el servicio se vendió por debajo del precio de lista.</p>
                </Box>
            </div>
        </div>
    );
};

export default InstallerRatesTable;
