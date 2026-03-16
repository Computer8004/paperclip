import type { AdapterConfigFieldsProps } from "../types";
import {
  Field,
  DraftInput,
  DraftTextarea,
} from "../../components/agent-config-primitives";
import { LocalWorkspaceRuntimeFields } from "../local-workspace-runtime-fields";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";

export function HermesLocalConfigFields({
  mode,
  isCreate,
  adapterType,
  values,
  set,
  config,
  eff,
  mark,
  models,
}: AdapterConfigFieldsProps) {
  return (
    <>
      <Field label="Hermes binary path" hint="Optional. Path to hermes CLI binary if not in PATH.">
        <DraftInput
          value={
            isCreate
              ? values?.command ?? ""
              : eff("adapterConfig", "hermesCommand", String(config.hermesCommand ?? ""))
          }
          onCommit={(v: string) =>
            isCreate
              ? set!({ command: v || undefined })
              : mark("adapterConfig", "hermesCommand", v || undefined)
          }
          immediate
          className={inputClass}
          placeholder="hermes (default: find in PATH)"
        />
      </Field>

      <LocalWorkspaceRuntimeFields
        isCreate={isCreate}
        values={values}
        set={set}
        config={config}
        mark={mark}
        eff={eff}
        mode={mode}
        adapterType={adapterType}
        models={models}
      />
    </>
  );
}

export function HermesLocalAdvancedFields({
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
}: AdapterConfigFieldsProps) {
  return (
    <>
      <Field label="Reasoning effort" hint="low, medium, high, or leave empty for default.">
        <DraftInput
          value={
            isCreate
              ? values?.thinkingEffort ?? ""
              : eff("adapterConfig", "thinkingEffort", String(config.thinkingEffort ?? ""))
          }
          onCommit={(v: string) =>
            isCreate
              ? set!({ thinkingEffort: v || undefined })
              : mark("adapterConfig", "thinkingEffort", v || undefined)
          }
          immediate
          className={inputClass}
          placeholder="e.g., medium"
        />
      </Field>

      <Field label="Extra CLI arguments" hint="Additional arguments passed to hermes CLI (space-separated).">
        <DraftInput
          value={
            isCreate
              ? values?.extraArgs ?? ""
              : eff("adapterConfig", "extraArgs", String((config.extraArgs as string[])?.join(" ") ?? ""))
          }
          onCommit={(v: string) =>
            isCreate
              ? set!({ extraArgs: v || undefined })
              : mark("adapterConfig", "extraArgs", v || undefined)
          }
          immediate
          className={inputClass}
          placeholder="--flag value"
        />
      </Field>

      <Field label="Prompt template" hint="Optional custom prompt template for the agent.">
        <DraftTextarea
          value={
            isCreate
              ? values?.promptTemplate ?? ""
              : eff("adapterConfig", "promptTemplate", String(config.promptTemplate ?? ""))
          }
          onCommit={(v: string) =>
            isCreate
              ? set!({ promptTemplate: v || undefined })
              : mark("adapterConfig", "promptTemplate", v || undefined)
          }
          placeholder="{{defaultSystemPrompt}}"
        />
      </Field>
    </>
  );
}
