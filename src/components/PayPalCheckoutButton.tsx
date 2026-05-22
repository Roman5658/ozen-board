import { PayPalButtons } from "@paypal/react-paypal-js"

type Props = {
    amountPLN: number | string
    description: string
    disabled?: boolean
    onApprove: (orderId: string) => void | Promise<void>
    onError: (message: string) => void
}

export default function PayPalCheckoutButton({
                                                 amountPLN,
                                                 description,
                                                 disabled = false,
                                                 onApprove,
                                                 onError,
                                             }: Props) {
    const value =
        typeof amountPLN === "number"
            ? amountPLN.toFixed(2)
            : amountPLN

    return (
        <PayPalButtons
            style={{ layout: "vertical", label: "paypal" }}
            disabled={disabled}
            createOrder={async (_data, actions) => {
                try {
                    const orderId = await actions.order.create({
                        intent: "CAPTURE",
                        application_context: {
                            locale: "pl-PL",
                            return_url: window.location.href,
                            cancel_url: window.location.href,
                            shipping_preference: "NO_SHIPPING",
                            user_action: "PAY_NOW",
                        },
                        purchase_units: [
                            {
                                description,
                                amount: {
                                    currency_code: "PLN",
                                    value,
                                },
                            },
                        ],
                    })
                    return orderId
                } catch (e) {
                    console.error(e)
                    onError("Unable to create PayPal payment")
                    throw e
                }
            }}
            onApprove={async (data) => {
                try {
                    if (!data.orderID) {
                        throw new Error("Missing PayPal order id")
                    }

                    await onApprove(data.orderID)
                } catch (e) {
                    console.error(e)
                    onError("PayPal payment could not be verified")
                }
            }}
            onCancel={() => {
                onError("Payment was canceled by user")
            }}
            onError={(err) => {
                console.error(err)
                onError("PayPal error during payment")
            }}
        />
    )
}
