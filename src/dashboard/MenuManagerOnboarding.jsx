import React, { memo, useState } from "react";
import { X } from "lucide-react";
import { persistOnboardingDismissed } from "./menuManagerUx";

const STEPS = [
  {
    title: "Choose the destination section.",
    examples: ["Breakfast → Eggs", "Daytime → Salads", "Desserts → Cakes"],
  },
  {
    title: "Press + Add Item",
    body: "Choose Add Existing Menu Item or Create New Item.",
  },
  {
    title: "When you're finished, press Publish to update the guest menu.",
  },
];

function MenuManagerOnboarding({ onDismiss }) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const handleDismiss = () => {
    persistOnboardingDismissed(dontShowAgain);
    onDismiss?.(dontShowAgain);
  };

  return (
    <section
      className="mm-onboarding"
      data-testid="menu-manager-onboarding"
      aria-label="Menu management getting started"
    >
      <button
        type="button"
        className="mm-onboarding-close"
        aria-label="Dismiss welcome guide"
        onClick={handleDismiss}
      >
        <X size={16} />
      </button>

      <div className="mm-onboarding-copy">
        <h2 className="mm-onboarding-title">Welcome to Menu Management</h2>
        <p className="mm-onboarding-subtitle">Here's how to update the guest menu.</p>

        <ol className="mm-onboarding-steps">
          {STEPS.map((step, index) => (
            <li key={step.title} className="mm-onboarding-step">
              <span className="mm-onboarding-step-index" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <p className="mm-onboarding-step-title">{step.title}</p>
                {step.examples ? (
                  <ul className="mm-onboarding-examples">
                    {step.examples.map((example) => (
                      <li key={example}>{example}</li>
                    ))}
                  </ul>
                ) : null}
                {step.body ? <p className="mm-onboarding-step-body">{step.body}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="mm-onboarding-footer">
        <label className="mm-onboarding-checkbox">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            data-testid="onboarding-dont-show-again"
          />
          <span>Don't show again</span>
        </label>
        <button
          type="button"
          className="mm-btn mm-btn-secondary mm-onboarding-dismiss"
          onClick={handleDismiss}
          data-testid="onboarding-dismiss"
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}

export default memo(MenuManagerOnboarding);
