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
                    onError("Не вдалося створити платіж PayPal")
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
                    onError("Платіж не підтверджено (capture помилка)")
                }
            }}
            onCancel={() => {
                onError("Оплату скасовано користувачем")
            }}
            onError={(err) => {
                console.error(err)
                onError("PayPal помилка під час оплати")
            }}
        />
    )
}
