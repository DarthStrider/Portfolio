import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    isWorking: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel, isWorking, onConfirm, onCancel }: ConfirmDialogProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);

    //Open/close the native dialog when the "open" prop changes
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        if (!open && dialog.open) dialog.close();
    }, [open]);

    return (
        <dialog ref={dialogRef} className="confirm-dialog" onCancel={onCancel}>
            <h2>{title}</h2>
            <p>{message}</p>
            <div className="dialog-actions">
                <button type="button" className="secondary" onClick={onCancel} disabled={isWorking}>
                    Cancel
                </button>
                <button type="button" className="danger" onClick={onConfirm} disabled={isWorking}>
                    {isWorking ? 'Deleting…' : confirmLabel}
                </button>
            </div>
        </dialog>
    );
}
