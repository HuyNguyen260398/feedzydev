/** The Share → Add to Home Screen steps for iPhone/iPad, shared by install and notification help. */
export default function IosInstallSteps() {
  return (
    <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
      <li>
        Tap <span className="font-medium text-text">Share</span>{' '}
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="inline align-[-2px] text-accent"
        >
          <path d="M12 15V3M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
        </svg>{' '}
        in the browser toolbar.
      </li>
      <li>
        Choose <span className="font-medium text-text">Add to Home Screen</span>.
      </li>
    </ol>
  );
}
