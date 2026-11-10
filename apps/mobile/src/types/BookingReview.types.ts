export interface BookingReviewProps {
  /** Left out inside the confirmation sheet, whose own title names it; then the review drops its card frame too. */
  heading?: string;
  /** On a reschedule, the appointment this time replaces. */
  replaces?: string;
  businessAndService: string; timeAndStaff: string; durationAndPrice: string; cancellation: string; advisory: string;
  /** Set when the chosen time is already inside the business's change window. */
  warning?: string;
}
