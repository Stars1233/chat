/**
 * Slack modal (view) converter.
 * Converts ModalElement to Slack Block Kit view format.
 */

import type {
  ModalChild,
  ModalElement,
  SelectElement,
  TextInputElement,
} from "chat";
import {
  convertFieldsToBlock,
  convertTextToBlock,
  type SlackBlock,
} from "./cards";

export interface SlackView {
  type: "modal";
  callback_id: string;
  title: { type: "plain_text"; text: string };
  submit?: { type: "plain_text"; text: string };
  close?: { type: "plain_text"; text: string };
  notify_on_close?: boolean;
  private_metadata?: string;
  blocks: SlackBlock[];
}

export interface SlackModalResponse {
  response_action?: "errors" | "update" | "push" | "clear";
  errors?: Record<string, string>;
  view?: SlackView;
}

export function modalToSlackView(
  modal: ModalElement,
  contextId?: string,
): SlackView {
  return {
    type: "modal",
    callback_id: modal.callbackId,
    title: { type: "plain_text", text: modal.title.slice(0, 24) },
    submit: modal.submitLabel
      ? { type: "plain_text", text: modal.submitLabel }
      : { type: "plain_text", text: "Submit" },
    close: modal.closeLabel
      ? { type: "plain_text", text: modal.closeLabel }
      : { type: "plain_text", text: "Cancel" },
    notify_on_close: modal.notifyOnClose,
    private_metadata: contextId,
    blocks: modal.children.map(modalChildToBlock),
  };
}

function modalChildToBlock(child: ModalChild): SlackBlock {
  switch (child.type) {
    case "text_input":
      return textInputToBlock(child);
    case "select":
      return selectToBlock(child);
    case "text":
      return convertTextToBlock(child);
    case "fields":
      return convertFieldsToBlock(child);
  }
}

function textInputToBlock(input: TextInputElement): SlackBlock {
  const element: Record<string, unknown> = {
    type: "plain_text_input",
    action_id: input.id,
    multiline: input.multiline ?? false,
  };

  if (input.placeholder) {
    element.placeholder = { type: "plain_text", text: input.placeholder };
  }
  if (input.initialValue) {
    element.initial_value = input.initialValue;
  }
  if (input.maxLength) {
    element.max_length = input.maxLength;
  }

  return {
    type: "input",
    block_id: input.id,
    optional: input.optional ?? false,
    label: { type: "plain_text", text: input.label },
    element,
  };
}

function selectToBlock(select: SelectElement): SlackBlock {
  const options = select.options.map((opt) => ({
    text: { type: "plain_text" as const, text: opt.label },
    value: opt.value,
  }));

  const element: Record<string, unknown> = {
    type: "static_select",
    action_id: select.id,
    options,
  };

  if (select.placeholder) {
    element.placeholder = { type: "plain_text", text: select.placeholder };
  }

  if (select.initialOption) {
    const initialOpt = options.find((o) => o.value === select.initialOption);
    if (initialOpt) {
      element.initial_option = initialOpt;
    }
  }

  return {
    type: "input",
    block_id: select.id,
    optional: select.optional ?? false,
    label: { type: "plain_text", text: select.label },
    element,
  };
}
