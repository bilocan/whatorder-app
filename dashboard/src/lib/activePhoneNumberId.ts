/** Meta phone_number_id for this dashboard build / dev env (see phoneRouting/{id}). */
export function getActivePhoneNumberId(): string | undefined {
  const id = import.meta.env.VITE_WHATSAPP_PHONE_NUMBER_ID as string | undefined;
  return id?.trim() || undefined;
}
