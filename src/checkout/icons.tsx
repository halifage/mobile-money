const Icon = ({ d }: { d: string }) => (
  <svg
    className="mm-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
)

export const CheckIcon = () => <Icon d="M5 12.5l4.5 4.5L19 7.5" />
export const CrossIcon = () => <Icon d="M6 6l12 12M18 6L6 18" />
export const ClockIcon = () => <Icon d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7v5l3 2" />
export const PhoneIcon = () => (
  <Icon d="M5 3h4l2 5l-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2" />
)
export const ChevronIcon = () => <Icon d="M6 9l6 6l6-6" />
