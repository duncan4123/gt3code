import { createFileRoute } from "@tanstack/react-router";

import { GasCitySettingsPanel } from "../components/settings/GasCitySettings";

export const Route = createFileRoute("/settings/gascity")({
  component: GasCitySettingsPanel,
});
