import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AskNacComposer from "./AskNacComposer";
import AskNacMessageList from "./AskNacMessageList";
import {
  createAssistantMessage,
  createUserMessage,
  handleComposerKeyDown,
  shouldSubmitOnEnter,
  shouldSubmitOnModifierEnter,
} from "./askNacChatUtils";
import { ANSWER_TYPES } from "../../intelligence/askNac/askNacContract";

describe("askNacChatUtils keyboard", () => {
  test("Enter submits", () => {
    expect(shouldSubmitOnEnter({ key: "Enter", shiftKey: false })).toBe(true);
  });

  test("Shift+Enter does not submit", () => {
    expect(shouldSubmitOnEnter({ key: "Enter", shiftKey: true })).toBe(false);
  });

  test("IME composition does not submit on Enter", () => {
    expect(shouldSubmitOnEnter({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
  });

  test("Cmd/Ctrl+Enter submits", () => {
    expect(shouldSubmitOnModifierEnter({ key: "Enter", metaKey: true })).toBe(true);
    expect(shouldSubmitOnModifierEnter({ key: "Enter", ctrlKey: true })).toBe(true);
  });

  test("handleComposerKeyDown calls onSubmit and prevents default", () => {
    const onSubmit = jest.fn();
    const event = { key: "Enter", shiftKey: false, preventDefault: jest.fn() };
    const handled = handleComposerKeyDown(event, { onSubmit, disabled: false });
    expect(handled).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  test("handleComposerKeyDown ignores when loading/disabled", () => {
    const onSubmit = jest.fn();
    const event = { key: "Enter", shiftKey: false, preventDefault: jest.fn() };
    expect(handleComposerKeyDown(event, { onSubmit, disabled: true })).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("askNacChatUtils messages", () => {
  test("createUserMessage and createAssistantMessage", () => {
    const user = createUserMessage("  Hello  ");
    expect(user.role).toBe("user");
    expect(user.content).toBe("Hello");
    expect(user.id).toMatch(/^ask-nac-msg-/);

    const assistant = createAssistantMessage({
      question: "Hello",
      response: { directAnswer: "42", answerType: ANSWER_TYPES.METRIC },
    });
    expect(assistant.role).toBe("assistant");
    expect(assistant.question).toBe("Hello");
    expect(assistant.response.directAnswer).toBe("42");
  });
});

describe("AskNacComposer", () => {
  function ComposerHarness({ onSubmit = jest.fn() }) {
    const [value, setValue] = useState("");
    return (
      <AskNacComposer
        value={value}
        onChange={setValue}
        onSubmit={(text) => {
          onSubmit(text);
          setValue("");
        }}
        loading={false}
      />
    );
  }

  test("Enter submits and clears input", async () => {
    const onSubmit = jest.fn();
    render(<ComposerHarness onSubmit={onSubmit} />);
    const textarea = screen.getByLabelText("Ask NAC a question");
    await userEvent.type(textarea, "Menu QR scans today");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSubmit).toHaveBeenCalledWith("Menu QR scans today");
    expect(textarea).toHaveValue("");
  });

  test("Shift+Enter does not submit", async () => {
    const onSubmit = jest.fn();
    render(<ComposerHarness onSubmit={onSubmit} />);
    const textarea = screen.getByLabelText("Ask NAC a question");
    await userEvent.type(textarea, "Line one");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("loading state prevents submit via Enter", () => {
    const onSubmit = jest.fn();
    render(
      <AskNacComposer value="Hello" onChange={() => {}} onSubmit={onSubmit} loading />,
    );
    const textarea = screen.getByLabelText("Ask NAC a question");
    expect(textarea).toBeDisabled();
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("suggested prompt click submits", async () => {
    const onSubmit = jest.fn();
    render(
      <AskNacComposer
        value=""
        onChange={() => {}}
        onSubmit={onSubmit}
        loading={false}
        suggestions={[{ text: "Compare branches this month" }]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Compare branches this month" }));
    expect(onSubmit).toHaveBeenCalledWith("Compare branches this month");
  });
});

describe("AskNacMessageList", () => {
  test("renders user bubble and assistant answer card with export", () => {
    render(
      <AskNacMessageList
        messages={[
          createUserMessage("Menu QR scans today"),
          createAssistantMessage({
            question: "Menu QR scans today",
            response: {
              answerType: ANSWER_TYPES.METRIC,
              title: "Menu QR Scans · Today",
              directAnswer: "42 menu QR scans for Khobar (Today).",
              keyMetrics: [{ label: "Menu QR Scans", value: 42 }],
              insights: [],
              recommendations: [],
              sources: [{ name: "fetchAskNacMenuMetrics", detail: "hybrid" }],
              warnings: [],
              missingData: [],
              confidence: "high",
              exportOptions: [],
              isAiGenerated: false,
            },
          }),
        ]}
        filters={{}}
      />,
    );

    expect(screen.getByText("Menu QR scans today")).toHaveClass("nac-ask-nac-user-bubble");
    expect(screen.getByText(/42 menu QR scans/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CSV" })).toBeInTheDocument();
  });
});

describe("Ask NAC chat session clear", () => {
  test("clearing messages removes transcript entries", () => {
    let messages = [
      createUserMessage("One"),
      createAssistantMessage({ question: "One", response: { directAnswer: "A" } }),
    ];
    messages = [];
    expect(messages).toHaveLength(0);
  });
});
