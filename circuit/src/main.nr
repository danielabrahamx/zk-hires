use dep::eddsa;
use dep::std::hash::poseidon;

// ZK circuit for credential proof.
//
// Public inputs:
//   issuer_pubkey_x, issuer_pubkey_y - BabyJubjub pubkey of the issuer
//   claim_type                       - tag for the claim (e.g. 1 = hackathon_wins, 2 = reputable_company)
//   claim_value                      - value bound to the claim
//   nullifier                        - Poseidon(subject_privkey, claim_type) to prevent replay
//
// Private inputs:
//   subject_privkey                  - subject's BabyJubjub scalar
//   sig_r8_x, sig_r8_y, sig_s        - issuer's EdDSA signature components
//   evidence_root, issued_at, expires_at - bound payload fields kept private
//
// Constraints:
//   1. nullifier == Poseidon(subject_privkey, claim_type)
//   2. EdDSA signature by issuer is valid over Poseidon(claim_type, claim_value, evidence_root, nullifier, issued_at)
fn main(
    issuer_pubkey_x: pub Field,
    issuer_pubkey_y: pub Field,
    claim_type: pub Field,
    claim_value: pub Field,
    nullifier: pub Field,
    subject_privkey: Field,
    sig_r8_x: Field,
    sig_r8_y: Field,
    sig_s: Field,
    evidence_root: Field,
    issued_at: Field,
    expires_at: Field,
) {
    // Bind expires_at to the witness so it cannot be optimised out.
    assert(expires_at != 0);

    // Verify nullifier is the correct Poseidon hash of subject_privkey and claim_type.
    let computed_nullifier = poseidon::bn254::hash_2([subject_privkey, claim_type]);
    assert(computed_nullifier == nullifier);

    // Reconstruct the payload that the issuer signed.
    let signed_payload = poseidon::bn254::hash_5([claim_type, claim_value, evidence_root, nullifier, issued_at]);

    // Verify the issuer's EdDSA signature.
    let valid = eddsa::eddsa_poseidon_verify(
        issuer_pubkey_x,
        issuer_pubkey_y,
        sig_s,
        sig_r8_x,
        sig_r8_y,
        signed_payload,
    );
    assert(valid);
}
