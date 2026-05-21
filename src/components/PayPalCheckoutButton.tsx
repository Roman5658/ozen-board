import { PayPalButtons } from "@paypal/react-paypal-js"

type Props = {
    amountPLN: number
    description: string
    onSuccess: (orderId: string) => void
    onError: (message: string) => void
}

export default function PayPalCheckoutButton({
                                                 amountPLN,
                                                 description,
                                                 onSuccess,
                                                 onError,
                                             }: Props) {
    const value = amountPLN.toFixed(2)

    return (
        <PayPalButtons
            style={{ layout: "vertical", label: "paypal" }}
            createOrder={async (_data, actions) => {
                try {
                    const orderId = await actions.order.create({
                        intent: "CAPTURE",
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
            onApprove={async (_data, actions) => {
                try {
                    const capture = await actions.order?.capture()
                    const orderId = capture?.id ?? ""
                    onSuccess(orderId)
                } catch (e) {
                    console.error(e)
                    onError("Payment was not captured successfully")
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
