// Centralized AuthProvider registration. Importing this module from
// any auth route guarantees the local-password implementation is
// registered before getAuthProvider() is called.
//
// Other auth implementations (SAML/OIDC, M2) can replace the
// registration in a single place without touching route code.
import { LocalPasswordAuthProvider } from "./auth-provider-local";
import { registerAuthProvider } from "./auth-provider";

registerAuthProvider(new LocalPasswordAuthProvider());
