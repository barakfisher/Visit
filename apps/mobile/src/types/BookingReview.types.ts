export interface BookingReviewProps {
  heading: string; businessAndService: string; timeAndStaff: string; durationAndPrice: string; cancellation: string; advisory: string;
  /** Set when the chosen time is already inside the business's change window. */
  warning?: string;
}
