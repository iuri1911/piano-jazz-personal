# Piano Jazz Trainer

**No ar: https://iuri1911.github.io/piano-jazz-personal/**

Treino de piano por MIDI: voicings de jazz e shredding. O som do piano vem do seu teclado — o app só sintetiza o clique do metrônomo, na aba Shred.

Para rodar local:

```bash
npm install && npm run dev
```

Abrir em **Chrome ou Edge** (Web MIDI API não existe no Firefox/Safari) e aceitar o acesso MIDI.

- **Visualizador** — toca qualquer coisa, mostra teclado, pauta, nome do acorde, intervalos, e reconhece qual voicing é.
- **Drill** — escolhe voicing e qualidade, ele pede o acorde nos 12 tons e valida nota por nota, oitava exata.
- **Shred** — exercícios de velocidade contra metrônomo, do iniciante ao avançado, com subida gradual de BPM.

O pedal de sustain conta: nota solta com o pedal pisado continua fazendo parte do acorde, igual ao piano. Para trocar de acorde, levanta o pedal.

Os 10 voicings ficam em [`src/voicings.ts`](src/voicings.ts), escritos como graus (`"3'"` = terça uma oitava acima). Para corrigir ou adicionar um voicing, mexer só nessa tabela.

## Shred

17 exercícios em 5 níveis — técnica pura, prog (ELP/Dream Theater), licks de guitarra e bebop — em [`src/shred/exercises.ts`](src/shred/exercises.ts). Mesma ideia dos voicings: cada exercício é a FORMA do desenho, e sai nos 12 tons e em qualquer subdivisão. Para adicionar um exercício, mexer só nessa tabela.

A repetição passa quando as notas saem certas na ordem **e** o espaçamento entre ataques é regular (coeficiente de variação abaixo do limite do nível), no andamento pedido ±3%. Regularidade importa mais que grudar no clique: shred embolado quase sempre está certo na média e errado no detalhe. Duas repetições limpas sobem o BPM; duas falhas descem.

Como o desenho esperado é conhecido nota a nota, o app acumula o desvio **por nota** e aponta qual você embola — normalmente a que vem logo depois da passagem de polegar.

Sobre ser permissivo na entrada, que é onde é fácil errar a mão:

- O orçamento de erro tem **piso de 1**. Numa volta de 17 notas, 3% arredondado daria zero, e exigir execução perfeita não é treino.
- Depois de dois ataques seguidos sem casar, o alinhamento **abre a busca** e reencontra a linha. Sem isso, derrapar e pular mais de 3 notas travava o cursor e todo o resto da volta virava "sobrando".
- A folga nas bordas da volta é **fração de tempo, não milissegundos fixos** — a 80 BPM um tempo tem 750ms, e uma folga fixa de 120ms descartava nota que entrou no lugar certo.
- Volta em que você não tocou (ajustando o teclado, lendo a tela) não conta como falha e **não desce o BPM**.
- Exercício que sobe volta descendo. Antes, os que só subiam teleportavam duas oitavas no fim da volta — impossível de tocar em loop. A descida é o **espelho em torno do topo**, não a figura tocada de trás pra frente: para desenho simétrico dá no mesmo, mas para figura assimétrica (Hanon) o espelho é a forma descendente de verdade.
- Se as notas que faltaram e as que sobraram são o mesmo desenho deslocado, ele diz: *"você tocou tudo 1 oitava abaixo"*. É o erro mais comum e o mais confuso quando aparece como erro cru.

Se as notas aparecem sistematicamente longe do clique, ajuste **atraso** em *Teclado e entrada* até o número `grade` do veredito cair. Deslocamento constante não afeta a regularidade nem a aprovação — mexe só em onde a nota aparece contra a grade e no piano-roll.

As notas caindo trazem o **número do dedo**, colorido por mão (direita em azul, esquerda em cinza), com um toggle em *Teclado e entrada*. Onde o dedilhado é padrão de verdade ele está escrito; onde depende da mão que chega na nota ou do tom — oitavas mão-a-mão, toccata, ostinato, envolvente bebop — não tem número, e a nota do exercício diz por quê. Número errado atrapalha mais que número nenhum.

A esquerda tem lista própria quando a forma dela é outra: em Dó maior a direita faz `1 2 3 1 2 3 4` e a esquerda `1 4 3 2 1 3 2`. Não sai uma da outra por fórmula, então onde a lista da esquerda não existe ela fica sem número em vez de herdar o da direita.

**Ouvir** toca o exercício num piano sintetizado, no andamento que você escolheu, com o piano-roll andando junto — serve pra decorar o desenho antes de tentar. É oscilador com queda exponencial, não piano amostrado: o que interessa é altura e ritmo audíveis.

O checkbox **referência** faz esse mesmo piano tocar *durante* o exercício, volta após volta, enquanto você é avaliado — útil pra padrão que você ainda não decorou. Tem volume próprio, separado do clique, porque o balanço contra o som do seu teclado é você quem sabe. Vem desligado: piano tocando junto é escolha, não surpresa. As notas são agendadas um tempo por vez, então o Hanon não cria 320 osciladores quarenta segundos antes de precisar deles.

O andamento é seu: **− / +** (de 10 em 10) ou o campo de BPM no cabeçalho, mais um slider. Mudar na mão zera as sequências de limpas, senão o próximo acerto promoveria de um ponto que você não conquistou. No modo *acelerando* quem manda é a curva, então o controle sai.

Quando a volta atual pode promover, o piano-roll avisa antes: **"esta volta limpa sobe para 90 BPM"**. E quando o andamento muda de verdade, aparece **↑ 90 BPM** em letra grande e o transporte dá um compasso de contagem no tempo novo — o andamento não troca embaixo da sua mão sem aviso.

Logo abaixo fica a contagem para o próximo degrau — `●○ mais 1 limpa e sobe para 70 BPM` — e ela vira vermelha contando as falhas quando o andamento está prestes a descer. Sobe e desce na mesma grade de 10, então falhar desfaz exatamente a última subida.

Tudo que você seleciona — exercício, tom, mãos, ordem, modo, rigor, andamento, volume, faixa do teclado — fica salvo e volta igual no próximo carregamento.

**Sobe após** define quantas voltas limpas *seguidas* promovem: 1, 2 ou 3. Em 2 (o padrão) uma volta ruim zera a contagem, e em exercício curto — o arpejo de sétima dura 3 segundos — é fácil nunca emendar duas e o andamento parecer travado. Se for esse o caso, use **1 limpa**: acertou, subiu.

O slider **clique** controla só o volume do metrônomo; o piano do *Ouvir* não passa por ele, então dá para silenciar o clique e continuar ouvindo o exercício.

**Rigor** define o quão permissivo é o veredito, por cima do padrão do nível do exercício — e a tela mostra os números que ele aplica, não é botão misterioso:

| | erros em 64 notas | irregularidade | andamento |
|---|---|---|---|
| aprendendo | 6 | só medido | só medido |
| solto | 4 | 22% | ±10% |
| padrão do nível | 2 | 14% | ±5% |
| exigente | 1 | 11% | ±3% |

*Aprendendo* é o que você quer enquanto ainda está decorando a forma: timing continua medido e aparecendo na tela, mas não reprova.

O seletor **Mãos** sobrepõe o arranjo da tabela: *só direita*, *só esquerda*, *as duas em oitava*, ou *como escrito* (o arranjo próprio do exercício). Mão separada e depois junta é a ordem normal de estudar qualquer passagem — o desenho, a subdivisão e o dedilhado ficam os mesmos, só muda quem toca. Em 49 teclas nem tudo cabe dobrado em oitava: quando não cabe, o app corta uma oitava e diz por quê.

Modos: escada (padrão), rajada (toca uma volta, descansa uma), acelerando (o clique sobe do inicial ao alvo) e livre.

Configure a faixa do teclado em *Teclado e entrada* — o botão **Detectar** grava a nota mais grave e a mais aguda que você tocar. O padrão é C2–C6, um controlador de 49 teclas. Dá para tocar pelo teclado do computador quando o controlador não está na mesa.

`npm test` cobre transposição, validação, o parser de mensagens MIDI, a expansão dos padrões de shred nos 12 tons, o alinhamento tocado×esperado e a subida de andamento.
