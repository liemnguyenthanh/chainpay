CREATE TABLE payer_challenges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_id uuid NOT NULL REFERENCES payments(id),
 payer_address text NOT NULL CHECK(payer_address ~ '^0x[0-9a-f]{40}$'),
 domain text NOT NULL, chain_id integer NOT NULL CHECK(chain_id=84532), nonce text NOT NULL UNIQUE,
 message text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payer_bindings (
 payment_id uuid PRIMARY KEY REFERENCES payments(id), payer_address text NOT NULL CHECK(payer_address ~ '^0x[0-9a-f]{40}$'),
 start_block numeric NOT NULL CHECK(start_block>=0 AND start_block=trunc(start_block)),
 allocation_key text UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE checkout_sessions (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[0-9a-f]{64}$'), payment_id uuid NOT NULL REFERENCES payer_bindings(payment_id),
 payer_address text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payment_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_id uuid NOT NULL REFERENCES payments(id),
 chain_id integer NOT NULL CHECK(chain_id=84532), tx_hash text NOT NULL CHECK(tx_hash ~ '^0x[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'SUBMITTED' CHECK(status IN ('SUBMITTED','VERIFYING','PENDING_CHAIN','CONFIRMING','REJECTED','NEEDS_REVIEW','VERIFIED')),
 version integer NOT NULL DEFAULT 0 CHECK(version>=0), block_number numeric, block_hash text, log_index integer,
 error_code text, retry_count integer NOT NULL DEFAULT 0 CHECK(retry_count>=0), next_check_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(payment_id,tx_hash)
);
CREATE UNIQUE INDEX one_active_attempt ON payment_attempts(payment_id) WHERE status NOT IN ('REJECTED','VERIFIED');
CREATE INDEX attempt_recovery ON payment_attempts(next_check_at,lease_until) WHERE status IN ('SUBMITTED','VERIFYING','PENDING_CHAIN','CONFIRMING');
CREATE TABLE settlements (
 payment_id uuid PRIMARY KEY REFERENCES payments(id), chain_id integer NOT NULL CHECK(chain_id=84532),
 tx_hash text NOT NULL CHECK(tx_hash ~ '^0x[0-9a-f]{64}$'), block_number numeric NOT NULL,
 block_hash text NOT NULL, log_index integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(chain_id,tx_hash)
);
CREATE TABLE outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_type text NOT NULL CHECK(event_type IN ('VERIFY_ATTEMPT','PAYMENT_UPDATED')),
 aggregate_id uuid NOT NULL, payload jsonb NOT NULL, available_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz, delivered_at timestamptz, attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX outbox_pending ON outbox(available_at,lease_until) WHERE delivered_at IS NULL;
