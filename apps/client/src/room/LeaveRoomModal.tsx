import { useTranslation } from 'react-i18next';
import { useUi } from '../state/ui';
import { Modal, Panel } from '../ui/common';
import { confirmLeave } from './leave';

/** Confirmación propia (no `window.confirm`) al salir de una sala ya empezada. */
export function LeaveRoomModal() {
  const { t } = useTranslation();
  const open = useUi((s) => s.confirmLeave);
  if (!open) return null;
  const close = () => useUi.getState().setConfirmLeave(false);
  return (
    <div className="absolute inset-0 z-50">
      <Modal onClose={close}>
        <Panel title={t('room.leaveConfirm.title')} className="mx-auto max-w-md">
          <p className="text-sm text-slate-200">{t('room.leaveConfirm.body')}</p>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn btn-primary" onClick={close} autoFocus>{t('room.leaveConfirm.stay')}</button>
            <button className="btn" onClick={confirmLeave}>{t('room.leaveConfirm.leave')}</button>
          </div>
        </Panel>
      </Modal>
    </div>
  );
}
