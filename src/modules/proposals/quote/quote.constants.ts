/** Proposta enviada como página (cotação por link). */
export const QUOTE_KIND = 'QUOTE';

// Limites da cotação: os mesmos no DTO, na leitura do modelo e na página.
export const QUOTE_MAX_ITEMS = 10;
export const QUOTE_PROVIDER_MAX = 80;
export const QUOTE_TITLE_MAX = 200;
/** Descrição, política de cancelamento e observação. */
export const QUOTE_TEXT_MAX = 600;
export const QUOTE_MAX_PEOPLE = 20;
export const QUOTE_CUSTOMER_NAME_MAX = 60;
/** Teto de sanidade de valores; a coluna é Decimal(12, 2). */
export const QUOTE_MAX_AMOUNT = 9_999_999;
/** Parcelamento no cartão: até 10x (regra comercial de 27/10/2026). */
export const QUOTE_MAX_INSTALLMENTS = 10;
export const QUOTE_DEFAULT_CURRENCY = 'BRL';

export const QUOTE_MIN_VALIDITY_HOURS = 1;
export const QUOTE_DEFAULT_VALIDITY_HOURS = 24;
/** 7 dias. */
export const QUOTE_MAX_VALIDITY_HOURS = 168;
export const HOUR_MS = 60 * 60 * 1000;

/** 24 bytes em base64url = 32 caracteres. */
export const QUOTE_TOKEN_BYTES = 24;
/** O mesmo formato dos links públicos de contrato. */
export const QUOTE_TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
/** Código curto mostrado ao cliente: os últimos 6 do id. */
export const QUOTE_CODE_LENGTH = 6;
/** Número da cotação para o cliente: 152 → "0152". */
export const QUOTE_NUMBER_DIGITS = 4;
/** Duas cotações gravadas no mesmo instante disputam o número: tenta de novo. */
export const QUOTE_NUMBER_ATTEMPTS = 3;
/** Caminho da página no front quando `QUOTE_PUBLIC_URL` não está definida. */
export const QUOTE_FALLBACK_PATH = '/cotacao';

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const CURRENCY_RE = /^[A-Z]{3}$/;

/** Telefone com DDI, só dígitos (E.164 sem o +). */
export const PHONE_MIN_DIGITS = 10;
export const PHONE_MAX_DIGITS = 15;

// Ficha do hotel (LiteAPI): limites iguais no DTO, na busca e na página.
export const QUOTE_HOTEL_ID_MAX = 40;
export const QUOTE_HOTEL_NAME_MAX = 120;
export const QUOTE_HOTEL_SUMMARY_MAX = 600;
export const QUOTE_HOTEL_ADDRESS_MAX = 200;
export const QUOTE_HOTEL_MAX_AMENITIES = 8;
export const QUOTE_HOTEL_AMENITY_MAX = 40;
export const QUOTE_HOTEL_MAX_PHOTOS = 8;
/** Só foto do CDN de imagens da LiteAPI entra na página e no PDF. */
export const QUOTE_HOTEL_PHOTO_RE = /^https:\/\/static\.cupid\.travel\/[A-Za-z0-9/_.-]{1,200}\.(?:jpe?g|png|webp)$/i;
export const QUOTE_HOTEL_TIME_RE = /^\d{1,2}h(?:\d{2})?$/;
