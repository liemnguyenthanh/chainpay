CREATE TABLE merchants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE,
 receiver_address text NOT NULL CHECK (receiver_address ~ '^0x[0-9a-f]{40}$' AND receiver_address <> '0x0000000000000000000000000000000000000000'),
 password_hash text NOT NULL, created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE merchant_sessions (
 token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
 merchant_id uuid NOT NULL REFERENCES merchants(id), expires_at timestamptz NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX session_expiry ON merchant_sessions(expires_at);
CREATE TABLE payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid NOT NULL REFERENCES merchants(id),
 idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[!-~]{1,128}$'), normalized_request text NOT NULL,
 chain_id integer NOT NULL CHECK (chain_id = 84532),
 token_address text NOT NULL CHECK (token_address = '0x036cbd53842c5426634e7929541ec2318f3dcf7e'),
 token_decimals integer NOT NULL CHECK (token_decimals = 6),
 -- Unconstrained numeric deliberately avoids rounding fractional input before CHECK.
 amount_base_units numeric NOT NULL CHECK (amount_base_units = trunc(amount_base_units) AND amount_base_units > 0 AND amount_base_units <= 115792089237316195423570985008687907853269984665640564039457584007913129639935),
 receiver_address text NOT NULL CHECK (receiver_address ~ '^0x[0-9a-f]{40}$' AND receiver_address <> '0x0000000000000000000000000000000000000000'),
 checkout_token_hash text NOT NULL UNIQUE CHECK (checkout_token_hash ~ '^[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'AWAITING_PAYMENT' CHECK (status IN ('AWAITING_PAYMENT','PROCESSING','CONFIRMED')),
 version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
 created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(), confirmed_at timestamptz(3),
 UNIQUE(merchant_id,idempotency_key),
 CHECK ((status = 'CONFIRMED') = (confirmed_at IS NOT NULL)),
 CHECK (normalized_request = chain_id::text || ':USDC:' || amount_base_units::text)
);
CREATE INDEX payment_merchant_listing ON payments(merchant_id,created_at DESC,id DESC);
