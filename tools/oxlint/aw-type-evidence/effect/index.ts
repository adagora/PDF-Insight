import { eslintCompatPlugin } from "@oxlint/plugins";

import { noServiceConstructorImportsRule } from "./rules/no-service-constructor-imports.ts";

const awTypeEvidenceEffectPlugin = eslintCompatPlugin({
	meta: { name: "aw-type-evidence-effect" },
	rules: {
		"no-service-constructor-imports": noServiceConstructorImportsRule,
	},
});

export default awTypeEvidenceEffectPlugin;
