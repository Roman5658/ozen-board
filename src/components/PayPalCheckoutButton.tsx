import { useRef } from "react"
import { PayPalButtons } from "@paypal/react-paypal-js"

type Props = {
    amountPLN: number | string
    description: string
    disabled?: boolean
    paymentCompleted?: boolean
    orderId?: string | null
    onApprove: (orderId: string) => void | Promise<void>
    onError: (message: string) => void
}

export default function PayPalCheckoutButton({
                                                 amountPLN,
                                                 description,
                                                 disabled = false,
                                                 paymentCompleted = false,
                                                 orderId = null,
                                                 onApprove,
                                                 onError,
                                             }: Props) {
    const approvedOrderIdRef = useRef<string | null>(null)
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

                    approvedOrderIdRef.current = data.orderID
                    await onApprove(data.orderID)
                } catch (e) {
                    console.error(e)
                    onError("PayPal payment could not be verified")
                }
            }}
            onCancel={() => {
                if (paymentCompleted || orderId || approvedOrderIdRef.current) {
                    return
                }

                console.warn("PayPal payment window was closed before approval")
            }}
            onError={(err) => {
                console.error(err)
                onError("PayPal error during payment")
            }}
        />
    )
}
