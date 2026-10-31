import React from 'react';
import { Banknote, CreditCard, ArrowLeftRight } from 'lucide-react';

// Logos simplificados (colores de cada marca) para reconocer el método de un vistazo
const Tile = ({ bg, fg = '#fff', children }) => (
    <span className="w-9 h-9 rounded-lg flex items-center justify-center font-black text-[11px] leading-none shrink-0"
        style={{ background: bg, color: fg }}>
        {children}
    </span>
);

const LOGOS = {
    efectivo: <Tile bg="#16a34a"><Banknote className="w-5 h-5" /></Tile>,
    breb: <Tile bg="#0b2a5b" fg="#facc15"><span className="tracking-tight">Bre‑B</span></Tile>,
    nequi: <Tile bg="#200020" fg="#ff2d9b"><span className="text-[17px] font-black">N</span></Tile>,
    daviplata: <Tile bg="#e30613"><span className="text-[17px] font-black">D</span></Tile>,
    bancolombia: (
        <Tile bg="#fdda24" fg="#111">
            <svg viewBox="0 0 24 24" className="w-6 h-6" aria-hidden="true">
                <rect x="3" y="5" width="18" height="3" rx="1.2" fill="#111" />
                <rect x="3" y="10.5" width="14" height="3" rx="1.2" fill="#111" />
                <rect x="3" y="16" width="9" height="3" rx="1.2" fill="#111" />
            </svg>
        </Tile>
    ),
    tarjeta_debito: <Tile bg="#0369a1"><CreditCard className="w-5 h-5" /></Tile>,
    tarjeta_credito: <Tile bg="#7c3aed"><CreditCard className="w-5 h-5" /></Tile>,
    transferencia: <Tile bg="#0f766e"><ArrowLeftRight className="w-5 h-5" /></Tile>,
    tarjeta: <Tile bg="#475569"><CreditCard className="w-5 h-5" /></Tile>,
    otro: <Tile bg="#475569">···</Tile>,
};

/** Métodos que se ofrecen al registrar un abono (los anteriores 'tarjeta'/'otro' solo se muestran en el historial) */
export const PAYMENT_METHODS = [
    { v: 'efectivo', l: 'Efectivo' },
    { v: 'breb', l: 'Bre-B' },
    { v: 'nequi', l: 'Nequi' },
    { v: 'daviplata', l: 'Daviplata' },
    { v: 'bancolombia', l: 'Bancolombia' },
    { v: 'tarjeta_debito', l: 'Tarjeta débito' },
    { v: 'tarjeta_credito', l: 'Tarjeta crédito' },
    { v: 'transferencia', l: 'Transferencia' },
];
const LABELS = { ...Object.fromEntries(PAYMENT_METHODS.map(m => [m.v, m.l])), tarjeta: 'Tarjeta', otro: 'Otro', sin_pago: 'Sin pago' };
export const paymentMethodLabel = (v) => LABELS[v] || v;
export const PaymentMethodLogo = ({ method }) => LOGOS[method] || LOGOS.otro;

/** Cuadrícula de métodos de pago con su logo */
export const PaymentMethodPicker = ({ value, onChange }) => (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup" data-testid="pay-method-picker">
        {PAYMENT_METHODS.map(m => (
            <button
                key={m.v}
                type="button"
                role="radio"
                aria-checked={value === m.v}
                onClick={() => onChange(m.v)}
                className={`flex items-center gap-2 p-2 rounded-lg border text-left text-xs font-medium transition-colors ${
                    value === m.v ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-border hover:bg-muted/50'}`}
                data-testid={`pay-method-${m.v}`}
            >
                {LOGOS[m.v]}
                <span className="leading-tight">{m.l}</span>
            </button>
        ))}
    </div>
);

export default PaymentMethodPicker;
