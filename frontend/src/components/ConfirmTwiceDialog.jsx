import React, { useState, useEffect } from 'react';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from './ui/alert-dialog';

const STEPS = [
    {
        title: '¿Ya terminó la Revisión 360°?',
        description: 'Verifique que tomó todas las fotos, grabó el video y marcó el estado de cada área.',
        confirm: 'Sí, ya terminé',
    },
    {
        title: 'Confirme de nuevo',
        description: '¿Está seguro de que la revisión está completa? Después de guardarla no se puede modificar.',
        confirm: 'Sí, completar revisión',
    },
];

/**
 * Pregunta dos veces antes de completar la revisión.
 * Props: open, onOpenChange(bool), onConfirm()
 */
export const ConfirmTwiceDialog = ({ open, onOpenChange, onConfirm }) => {
    const [step, setStep] = useState(0);

    useEffect(() => {
        if (open) setStep(0);
    }, [open]);

    const current = STEPS[step];

    const handleConfirm = (e) => {
        e.preventDefault();
        if (step < STEPS.length - 1) {
            setStep(step + 1);
            return;
        }
        onOpenChange(false);
        onConfirm();
    };

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent data-testid={`confirm-finish-step-${step + 1}`}>
                <AlertDialogHeader>
                    <AlertDialogTitle>{current.title}</AlertDialogTitle>
                    <AlertDialogDescription>{current.description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel data-testid="confirm-finish-cancel">No, seguir revisando</AlertDialogCancel>
                    <AlertDialogAction onClick={handleConfirm} data-testid={`confirm-finish-yes-${step + 1}`}>
                        {current.confirm}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default ConfirmTwiceDialog;
