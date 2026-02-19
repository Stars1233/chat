import DynamicLink from "fumadocs-core/dynamic-link";
import type { Metadata } from "next";
import { Installer } from "@/components/geistdocs/installer";
import { Button } from "@/components/ui/button";
import { CenteredSection } from "./components/centered-section";
import { CTA } from "./components/cta";
import { Hero } from "./components/hero";
import { OneTwoSection } from "./components/one-two-section";
import { Templates } from "./components/templates";
import { TextGridSection } from "./components/text-grid-section";
import { Usage } from "./components/usage";

const title = "Chat SDK";
const description =
  "A unified TypeScript SDK for building chat bots across Slack, Microsoft Teams, Google Chat, Discord, and more. Write your bot logic once, deploy everywhere.";

export const metadata: Metadata = {
  title,
  description,
};

const templates = [
  {
    title: "Template 1",
    description: "Description of template 1",
    link: "https://example.com/template-1",
    image: "https://placehold.co/600x400.png",
  },
  {
    title: "Template 2",
    description: "Description of template 2",
    link: "https://example.com/template-2",
    image: "https://placehold.co/600x400.png",
  },
  {
    title: "Template 3",
    description: "Description of template 3",
    link: "https://example.com/template-3",
    image: "https://placehold.co/600x400.png",
  },
];

const textGridSection = [
  {
    id: "1",
    title: "Multi-platform",
    description:
      "Deploy to Slack, Teams, Google Chat, Discord, GitHub, and Linear from a single codebase.",
  },
  {
    id: "2",
    title: "Type-safe",
    description:
      "Full TypeScript support with type-safe adapters, event handlers, and JSX cards.",
  },
  {
    id: "3",
    title: "AI streaming",
    description:
      "First-class support for streaming LLM responses with native platform rendering.",
  },
];

const HomePage = () => (
  <div className="container mx-auto max-w-5xl">
    <Hero
      badge="Chat SDK is now open source"
      description={description}
      title={title}
    >
      <div className="mx-auto inline-flex w-fit items-center gap-3">
        <Button asChild className="px-4" size="lg">
          <DynamicLink href="/[lang]/docs/getting-started">
            Get Started
          </DynamicLink>
        </Button>
        <Installer command="pnpm add chat" />
      </div>
    </Hero>
    <div className="grid divide-y border-y sm:border-x">
      <CenteredSection
        description="Description of centered section"
        title="Centered Section"
      >
        <div className="aspect-video rounded-lg border bg-background" />
      </CenteredSection>
      <TextGridSection data={textGridSection} />
      <OneTwoSection
        description="Install the SDK and pair it with your favorite chat providers and state management solutions."
        title="Usage"
      >
        <Usage />
      </OneTwoSection>
      <Templates
        data={templates}
        description="Description of templates section"
        title="Templates Section"
      />
      <CTA
        cta="Get started"
        href="/docs/getting-started"
        title="Build your first chat bot"
      />
    </div>
  </div>
);

export default HomePage;
