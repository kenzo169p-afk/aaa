using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

namespace SaaSContabil.PricingEngine
{
    public class RegimeParam
    {
        public string rotulo { get; set; }
        public double horas { get; set; }
        public double refMin { get; set; }
        public double refMax { get; set; }
    }

    public class AtividadeParam
    {
        public string rotulo { get; set; }
        public double mult { get; set; }
    }

    public class VolumeBracket
    {
        public string rotulo { get; set; }
        public double horas { get; set; }
    }

    public class ObrigacaoParam
    {
        public string id { get; set; }
        public string rotulo { get; set; }
        public double horas { get; set; }
    }

    public class AvulsoParam
    {
        public string id { get; set; }
        public string rotulo { get; set; }
        public double valor { get; set; }
    }

    public class BreakdownItem
    {
        public string nome { get; set; }
        public double horas { get; set; }
        public double valor { get; set; }
    }

    public class CalculationRequest
    {
        public double custoFixo { get; set; }
        public double horasProdutivas { get; set; }
        public double margem { get; set; }
        public string regime { get; set; }
        public string atividade { get; set; }
        public double faturamento { get; set; }
        public int funcionarios { get; set; }
        public int socios { get; set; }
        public int filiais { get; set; }
        public int volumeIndex { get; set; }
        public string complexidade { get; set; }
        public double horasPorFuncionario { get; set; }
        public double horasPorSocio { get; set; }
        public double horasPorFilial { get; set; }
        public double descontoPct { get; set; }
        public double descontoMaximoAutorizadoPct { get; set; }
        public double taxaImplantacao { get; set; }
        public double precoPretendido { get; set; }
        public double horasExtrasServicos { get; set; }
        public double valorFixoPlanoAdicional { get; set; }
        public Dictionary<string, bool> obrigacoes { get; set; }
        public Dictionary<string, double> avulsosSelecionados { get; set; }
        public Dictionary<string, RegimeParam> regimesConfig { get; set; }
        public Dictionary<string, AtividadeParam> atividadesConfig { get; set; }
        public List<VolumeBracket> volumeBracketsConfig { get; set; }
        public List<ObrigacaoParam> obrigacoesConfig { get; set; }
        public Dictionary<string, double> complexidadeMultConfig { get; set; }

        public CalculationRequest()
        {
            custoFixo = 28000.0;
            horasProdutivas = 320.0;
            margem = 30.0;
            regime = "simples";
            atividade = "servicos";
            faturamento = 50000.0;
            funcionarios = 2;
            socios = 1;
            filiais = 0;
            volumeIndex = 1;
            complexidade = "padrao";
            horasPorFuncionario = 0.45;
            horasPorSocio = 0.35;
            horasPorFilial = 1.50;
            descontoPct = 0.0;
            descontoMaximoAutorizadoPct = 15.0;
            taxaImplantacao = 0.0;
            precoPretendido = 0.0;
            horasExtrasServicos = 0.0;
            valorFixoPlanoAdicional = 0.0;
            obrigacoes = new Dictionary<string, bool>();
            avulsosSelecionados = new Dictionary<string, double>();
        }
    }

    public class CalculationResponse
    {
        public string engine { get; set; }
        public double custoHora { get; set; }
        public double horaTecnica { get; set; }
        public double horasTotais { get; set; }
        public double piso { get; set; }
        public double sugerido { get; set; }
        public double descontoPctAplicado { get; set; }
        public double valorDesconto { get; set; }
        public double honorarioFinal { get; set; }
        public bool descontoAutorizado { get; set; }
        public double refMin { get; set; }
        public double refMax { get; set; }
        public double totalAvulsos { get; set; }
        public double taxaImplantacao { get; set; }
        public string status { get; set; }
        public string statusMensagem { get; set; }
        public List<BreakdownItem> breakdown { get; set; }

        public CalculationResponse()
        {
            engine = "C# .NET NBC-PG-01 PricingEngine v2.0";
            breakdown = new List<BreakdownItem>();
        }
    }

    public static class AccountingCalculator
    {
        public static Dictionary<string, RegimeParam> DefaultRegimes()
        {
            return new Dictionary<string, RegimeParam>
            {
                { "mei", new RegimeParam { rotulo = "MEI", horas = 0.6, refMin = 90, refMax = 180 } },
                { "simples", new RegimeParam { rotulo = "Simples Nacional", horas = 3.0, refMin = 350, refMax = 900 } },
                { "presumido", new RegimeParam { rotulo = "Lucro Presumido", horas = 6.5, refMin = 700, refMax = 2200 } },
                { "real", new RegimeParam { rotulo = "Lucro Real", horas = 14.0, refMin = 1800, refMax = 7000 } }
            };
        }

        public static Dictionary<string, AtividadeParam> DefaultAtividades()
        {
            return new Dictionary<string, AtividadeParam>
            {
                { "comercio", new AtividadeParam { rotulo = "Comércio", mult = 1.0 } },
                { "servicos", new AtividadeParam { rotulo = "Serviços", mult = 1.05 } },
                { "industria", new AtividadeParam { rotulo = "Indústria", mult = 1.35 } }
            };
        }

        public static List<VolumeBracket> DefaultVolumeBrackets()
        {
            return new List<VolumeBracket>
            {
                new VolumeBracket { rotulo = "Até 20 NF/mês", horas = 0.0 },
                new VolumeBracket { rotulo = "21 a 80 NF/mês", horas = 1.5 },
                new VolumeBracket { rotulo = "81 a 200 NF/mês", horas = 4.0 },
                new VolumeBracket { rotulo = "201 a 500 NF/mês", horas = 8.0 },
                new VolumeBracket { rotulo = "Acima de 500/mês", horas = 14.0 }
            };
        }

        public static List<ObrigacaoParam> DefaultObrigacoes()
        {
            return new List<ObrigacaoParam>
            {
                new ObrigacaoParam { id = "efdcontrib", rotulo = "EFD-Contribuições", horas = 1.5 },
                new ObrigacaoParam { id = "efdreinf", rotulo = "EFD-Reinf", horas = 1.2 },
                new ObrigacaoParam { id = "ecd", rotulo = "ECD (Sped Contábil)", horas = 1.5 },
                new ObrigacaoParam { id = "ecf", rotulo = "ECF", horas = 1.5 },
                new ObrigacaoParam { id = "dctfweb", rotulo = "DCTFWeb", horas = 0.8 },
                new ObrigacaoParam { id = "icmsst", rotulo = "ICMS-ST / Diferencial", horas = 1.5 },
                new ObrigacaoParam { id = "comex", rotulo = "Comércio exterior (Imp/Exp)", horas = 2.5 }
            };
        }

        public static Dictionary<string, double> DefaultComplexidade()
        {
            return new Dictionary<string, double>
            {
                { "padrao", 1.0 },
                { "baixa", 0.90 },
                { "media", 1.10 },
                { "alta", 1.25 },
                { "especial", 1.50 }
            };
        }

        public static CalculationResponse Calculate(CalculationRequest req)
        {
            var regimes = req.regimesConfig ?? DefaultRegimes();
            var atividades = req.atividadesConfig ?? DefaultAtividades();
            var volumes = req.volumeBracketsConfig ?? DefaultVolumeBrackets();
            var obrigacoesCatalogo = req.obrigacoesConfig ?? DefaultObrigacoes();
            var complexidades = req.complexidadeMultConfig ?? DefaultComplexidade();

            // 1. Custo Hora (L) e Hora Técnica (P) - Fórmula Original Exata
            double L = req.horasProdutivas > 0 ? req.custoFixo / req.horasProdutivas : 0.0;
            double P = L * (1.0 + req.margem / 100.0);

            string regimeKey = (req.regime != null && regimes.ContainsKey(req.regime)) ? req.regime : "simples";
            string ativKey = (req.atividade != null && atividades.ContainsKey(req.atividade)) ? req.atividade : "servicos";

            RegimeParam H = regimes[regimeKey];
            AtividadeParam te = atividades[ativKey];

            double compMult = 1.0;
            if (!string.IsNullOrEmpty(req.complexidade) && complexidades.ContainsKey(req.complexidade))
            {
                compMult = complexidades[req.complexidade];
            }

            // 2. Horas por componente - Fórmula Original Exata
            double le = H.horas * te.mult * compMult;
            double R = req.funcionarios * (req.horasPorFuncionario > 0 ? req.horasPorFuncionario : 0.45);
            double V = req.socios * (req.horasPorSocio > 0 ? req.horasPorSocio : 0.35);
            double J = req.filiais * (req.horasPorFilial > 0 ? req.horasPorFilial : 1.50);

            int volIdx = req.volumeIndex;
            if (volIdx < 0) volIdx = 0;
            if (volIdx >= volumes.Count) volIdx = volumes.Count - 1;
            double re = volumes[volIdx].horas;

            double se = 0.0;
            if (req.obrigacoes != null)
            {
                foreach (var ob in obrigacoesCatalogo)
                {
                    if (req.obrigacoes.ContainsKey(ob.id) && req.obrigacoes[ob.id])
                    {
                        se += ob.horas;
                    }
                }
            }

            double ye = req.faturamento > 1000000.0 ? 4.0
                      : req.faturamento > 300000.0 ? 2.0
                      : req.faturamento > 80000.0 ? 0.8
                      : 0.0;

            var rawItems = new List<BreakdownItem>
            {
                new BreakdownItem { nome = H.rotulo + " (" + te.rotulo + ")", horas = le },
                new BreakdownItem { nome = "Folha / DP (" + req.funcionarios + " colab.)", horas = R },
                new BreakdownItem { nome = "Sócios / pró-labore", horas = V },
                new BreakdownItem { nome = "Volume fiscal", horas = re },
                new BreakdownItem { nome = "Obrigações acessórias", horas = se },
                new BreakdownItem { nome = "Filiais / IE adicionais", horas = J },
                new BreakdownItem { nome = "Porte / movimento", horas = ye }
            };

            if (req.horasExtrasServicos > 0)
            {
                rawItems.Add(new BreakdownItem { nome = "Serviços / Planos adicionais", horas = req.horasExtrasServicos });
            }

            var breakdown = new List<BreakdownItem>();
            double tt = 0.0;
            foreach (var item in rawItems)
            {
                if (item.horas > 0)
                {
                    tt += item.horas;
                    breakdown.Add(new BreakdownItem
                    {
                        nome = item.nome,
                        horas = Math.Round(item.horas, 4),
                        valor = Math.Round(item.horas * P, 2)
                    });
                }
            }

            double Oe = tt * L;
            double ce = (tt * P) + req.valorFixoPlanoAdicional;

            double totalAvulsos = 0.0;
            if (req.avulsosSelecionados != null)
            {
                foreach (var kv in req.avulsosSelecionados)
                {
                    totalAvulsos += kv.Value;
                }
            }

            double descontoPct = Math.Max(0.0, req.descontoPct);
            double valorDesconto = ce * (descontoPct / 100.0);
            double honorarioFinal = Math.Max(0.0, ce - valorDesconto);

            // Se o usuário digitou um preço pretendido explícito, usamos para checagem de status
            double precoParaChecagem = req.precoPretendido > 0 ? req.precoPretendido : (descontoPct > 0 ? honorarioFinal : 0.0);

            string status = null;
            string statusMsg = "Dentro da faixa recomendada para este perfil.";
            if (precoParaChecagem > 0)
            {
                if (precoParaChecagem < Oe)
                {
                    status = "aviltamento";
                    statusMsg = "Abaixo do piso de custo — risco de aviltamento (NBC PG 01, art. 8).";
                }
                else if (precoParaChecagem < ce * 0.92)
                {
                    status = "abaixo";
                    statusMsg = "Cobre o custo, mas comprime a margem-alvo do escritório.";
                }
                else if (precoParaChecagem > ce * 1.15)
                {
                    status = "acima";
                    statusMsg = "Acima do recomendado — viável se há diferencial de valor percebido.";
                }
                else
                {
                    status = "ok";
                    statusMsg = "Dentro da faixa recomendada para este perfil.";
                }
            }

            bool descontoAutorizado = (descontoPct <= req.descontoMaximoAutorizadoPct) && (honorarioFinal >= Oe);

            return new CalculationResponse
            {
                custoHora = Math.Round(L, 2),
                horaTecnica = Math.Round(P, 2),
                horasTotais = Math.Round(tt, 2),
                piso = Math.Round(Oe, 2),
                sugerido = Math.Round(ce, 2),
                descontoPctAplicado = Math.Round(descontoPct, 2),
                valorDesconto = Math.Round(valorDesconto, 2),
                honorarioFinal = Math.Round(req.precoPretendido > 0 ? req.precoPretendido : honorarioFinal, 2),
                descontoAutorizado = descontoAutorizado,
                refMin = H.refMin,
                refMax = H.refMax,
                totalAvulsos = Math.Round(totalAvulsos, 2),
                taxaImplantacao = Math.Round(req.taxaImplantacao, 2),
                status = status,
                statusMensagem = statusMsg,
                breakdown = breakdown
            };
        }
    }

    class Program
    {
        static int Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            var serializer = new JavaScriptSerializer();

            if (args.Length > 0 && args[0] == "--self-test")
            {
                // Cenário padrão exato do sistema original Replit:
                // custoFixo=28000, horasProdutivas=320 => custoHora = 87.50
                // margem=30% => horaTecnica = 113.75
                // regime=simples (3h) * servicos (1.05) = 3.15h
                // funcionarios=2 * 0.45 = 0.90h
                // socios=1 * 0.35 = 0.35h
                // volumeIndex=1 (21 a 80 NF/mês) = 1.50h
                // faturamento=50000 = 0h
                // horasTotais = 3.15 + 0.90 + 0.35 + 1.50 = 5.90h
                // piso = 5.90 * 87.50 = 516.25
                // sugerido = 5.90 * 113.75 = 671.125 -> 671.12 / 671.13
                var defaultReq = new CalculationRequest();
                var res = AccountingCalculator.Calculate(defaultReq);

                bool ok = Math.Abs(res.custoHora - 87.50) < 0.01
                       && Math.Abs(res.horaTecnica - 113.75) < 0.01
                       && Math.Abs(res.horasTotais - 5.90) < 0.01
                       && Math.Abs(res.piso - 516.25) < 0.01
                       && Math.Abs(res.sugerido - 671.12) < 0.02;

                Console.WriteLine(serializer.Serialize(new
                {
                    selfTestPassed = ok,
                    defaultScenarioResult = res
                }));
                return ok ? 0 : 1;
            }

            string inputJson = "";
            if (args.Length >= 2 && args[0] == "--file")
            {
                inputJson = File.ReadAllText(args[1], Encoding.UTF8);
            }
            else if (args.Length >= 2 && args[0] == "--json")
            {
                inputJson = args[1];
            }
            else
            {
                using (var reader = new StreamReader(Console.OpenStandardInput(), Encoding.UTF8))
                {
                    inputJson = reader.ReadToEnd();
                }
            }

            if (string.IsNullOrWhiteSpace(inputJson))
            {
                var defaultRes = AccountingCalculator.Calculate(new CalculationRequest());
                Console.WriteLine(serializer.Serialize(defaultRes));
                return 0;
            }

            try
            {
                var req = serializer.Deserialize<CalculationRequest>(inputJson);
                var result = AccountingCalculator.Calculate(req);
                Console.WriteLine(serializer.Serialize(result));
                return 0;
            }
            catch (Exception ex)
            {
                Console.WriteLine(serializer.Serialize(new { error = ex.Message }));
                return 1;
            }
        }
    }
}
