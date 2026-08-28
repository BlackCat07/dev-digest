/* AgentEditor — agent config editor (model + system prompt), the skills it
   sends with its prompt, the project documents it sends alongside them, and the
   eval set its output is scored against. Later lessons add Stats/CI tabs.
   Tab state lives in ?tab=. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { ContextTab } from "./_components/ContextTab";
import { EvalsTab } from "./_components/EvalsTab";
import { SkillsTab } from "./_components/SkillsTab";
import { TABS } from "./constants";
import { s } from "./styles";

/**
 * The panel for the active tab.
 *
 * A component rather than a chain of ternaries in the JSX below: each tab owns
 * its own data hooks, so the branch has to unmount one tab's queries when
 * another is selected, and early returns keep that legible as tabs are added.
 * An unknown `?tab=` falls through to Config, which is what `DEFAULT_TAB` says.
 */
function TabPanel({ tab, agent }: { tab: string; agent: Agent }) {
  if (tab === "skills") return <SkillsTab agent={agent} />;
  if (tab === "context") return <ContextTab agent={agent} />;
  if (tab === "evals") return <EvalsTab agent={agent} />;
  return <ConfigTab agent={agent} />;
}

export function AgentEditor({ agent, tab, onTab }: { agent: Agent; tab: string; onTab: (t: string) => void }) {
  const t = useTranslations("agents");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));
  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={s.body}>
        <TabPanel tab={tab} agent={agent} />
      </div>
    </div>
  );
}
