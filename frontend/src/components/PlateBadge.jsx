import React from 'react';

/**
 * Placa en rectángulo amarillo con letra negra, prominente.
 * Variants: 'sm' | 'md' | 'lg'
 */
export const PlateBadge = ({ plate, size = 'md', className = '', testId }) => {
    if (!plate) return null;
    const sizes = {
        sm: 'px-2 py-0.5 text-xs',
        md: 'px-3 py-1 text-base',
        lg: 'px-4 py-1.5 text-xl',
        xl: 'px-5 py-2 text-2xl',
    };
    return (
        <span
            className={`inline-flex items-center justify-center font-mono font-extrabold tracking-wider rounded-md border-2 border-yellow-600 bg-yellow-400 text-black shadow-sm ${sizes[size] || sizes.md} ${className}`}
            data-testid={testId || `plate-badge-${plate}`}
        >
            {String(plate).toUpperCase()}
        </span>
    );
};

export default PlateBadge;
