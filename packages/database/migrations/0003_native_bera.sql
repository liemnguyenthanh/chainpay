-- Expand the exact asset allowlist; never loosen to arbitrary token addresses.
ALTER TABLE payments DROP CONSTRAINT payments_chain_id_check;
ALTER TABLE payments DROP CONSTRAINT payments_token_address_check;
ALTER TABLE payments DROP CONSTRAINT payments_token_decimals_check;
ALTER TABLE payments DROP CONSTRAINT payments_check1;
ALTER TABLE payments ADD CONSTRAINT payments_asset_check CHECK (
 (chain_id=84532 AND token_address='0x036cbd53842c5426634e7929541ec2318f3dcf7e' AND token_decimals=6)
 OR (chain_id=80094 AND token_address='0x0000000000000000000000000000000000000000' AND token_decimals=18)
);
ALTER TABLE payments ADD CONSTRAINT payments_normalized_request_check CHECK (
 normalized_request=chain_id::text || CASE WHEN chain_id=80094 THEN ':BERA:' ELSE ':USDC:' END || amount_base_units::text
);
ALTER TABLE payer_challenges DROP CONSTRAINT payer_challenges_chain_id_check;
ALTER TABLE payer_challenges ADD CONSTRAINT payer_challenges_chain_id_check CHECK(chain_id IN (84532,80094));
ALTER TABLE payment_attempts DROP CONSTRAINT payment_attempts_chain_id_check;
ALTER TABLE payment_attempts ADD CONSTRAINT payment_attempts_chain_id_check CHECK(chain_id IN (84532,80094));
ALTER TABLE settlements DROP CONSTRAINT settlements_chain_id_check;
ALTER TABLE settlements ADD CONSTRAINT settlements_chain_id_check CHECK(chain_id IN (84532,80094));
-- Native value transfer has no ERC20 log. -1 is the explicit internal sentinel.
ALTER TABLE settlements ADD CONSTRAINT settlements_log_kind_check CHECK (
 (chain_id=80094 AND log_index=-1) OR (chain_id=84532 AND log_index>=0)
);
